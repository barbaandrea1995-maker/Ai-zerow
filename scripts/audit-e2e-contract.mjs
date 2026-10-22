import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function walk(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (["node_modules", ".next", "dist", ".wrangler"].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(absolute);
  }
  return files;
}

async function read(relative) {
  return fs.readFile(path.join(root, relative), "utf8");
}

function requireContract(source, pattern, label) {
  assert.ok(pattern.test(source), `Missing contract: ${label}`);
}

const commandAskRoute = await read("app/api/command/ask/route.ts");
const personalAssetContext = await read("lib/company-ai-personal-assets.ts");
const companyAiAdapter = await read("lib/company-ai-openai.ts");
requireContract(commandAskRoute, /eq\(jobJourneyRecords\.tenantId, context!\.tenantId\)/, "Company AI asset assignments are tenant scoped");
requireContract(commandAskRoute, /eq\(jobJourneyRecords\.recordType, "ASSET_ASSIGNMENT"\)/, "Company AI reads the asset custody registry");
requireContract(commandAskRoute, /buildCompanyAiPersonalAssetContext\(/, "Company AI enriches its context with personal asset custody");
requireContract(commandAskRoute, /operationalContext: companyAiOperationalContext/, "personal asset custody reaches the model context");
requireContract(personalAssetContext, /payload\.assigneeActorId.*actorId/, "personal assignment is filtered by authenticated actor");
requireContract(personalAssetContext, /payload\.assigneeMembershipId.*membershipId/, "personal assignment supports tenant membership identity");
requireContract(personalAssetContext, /status === "RETURNED" \|\| status === "CANCELLED"/, "returned or cancelled custody is excluded");
requireContract(companyAiAdapter, /personal_asset_assignment.*assegnazioni effettive/, "Company AI distinguishes personal custody from catalog presence");

const teamRoute = await read("app/api/authority/teams/route.ts");
const onboarding = await read("app/onboarding/page.tsx");
const resourceLibrary = await read("lib/planning-resources.ts");
const missionResourceLibrary = await read("lib/mission-resources.ts");
const missionResourceFields = await read("components/mission-resource-fields.tsx");
const resourceRoute = await read("app/api/operations/jobs/[jobId]/planning/resource-options/route.ts");
const planningOverviewRoute = await read("app/api/planning/route.ts");
const resourceFields = await read("components/planning-resource-fields.tsx");
const planningSurface = await read("components/planning-control.tsx");
const planningWriteRoute = await read("app/api/operations/jobs/[jobId]/planning/route.ts");
const authorityContext = await read("lib/authority-context.ts");
const authorityCatalog = await read("lib/authority-catalog.ts");
const warehouseRoute = await read("app/api/authority/warehouses/route.ts");
const warehouseCatalogRoute = await read("app/api/warehouse/catalog/route.ts");
const inventoryRoute = await read("app/api/warehouse/inventory/route.ts");
const jobJourneyRoute = await read("app/api/operations/jobs/[jobId]/journey/route.ts");
const materialFulfillment = await read("lib/material-fulfillment.ts");
const materialPickupRoute = await read("app/api/operations/jobs/[jobId]/material-pickup/route.ts");
const jobStockRoute = await read("app/api/operations/jobs/[jobId]/stock/route.ts");
const operationsJobRoute = await read("app/api/operations/jobs/[jobId]/route.ts");
const genericModuleRoute = await read("app/api/[module]/route.ts");
const assetProfileRoute = await read("app/api/assets/profile/route.ts");
const operationsRoute = await read("app/api/operations/route.ts");
const operationsJobSurface = await read("components/operations-job-workspace.tsx");
const operatingModel = await read("lib/tenant-operating-model.ts");
const jobStockMigration = await read("drizzle/0028_tricky_human_fly.sql");
const materialFulfillmentTests = await read("scripts/verify-material-fulfillment.mjs");
const warehouseRequestsRoute = await read("app/api/warehouse/requests/route.ts");
const attendanceRoute = await read("app/api/workforce/attendance/route.ts");
const warehouseQueueSurface = await read("components/warehouse-request-queue.tsx");
const attendanceSurface = await read("components/operational-attendance-deck.tsx");
const missionCommandSurface = await read("components/mission-command-deck.tsx");
const jobJourneySurface = await read("components/job-commercial-journey.tsx");
const membershipRoute = await read("app/api/authority/memberships/route.ts");
const warehouseComponent = await read("components/tenant-warehouse-control.tsx");
const warehouseControl = await read("components/warehouse-control.tsx");
const legacyS04Page = await read("components/s04-module-page.tsx");
const assetNamingDialog = await read("components/server-naming-dialog.tsx");
const genericS04Route = await read("app/api/[module]/route.ts");
const communicationsSurface = await read("components/communications-control.tsx");
const settingsSurface = await read("app/settings/settings-client.tsx");
const commandMapRoute = await read("app/api/command/map/route.ts");
const operationalMapSurface = await read("components/operational-map-board.tsx");
const commandAnalyticsRoute = await read("app/api/command/analytics/route.ts");
const commandReadinessRoute = await read("app/api/command/readiness/route.ts");
const commandSurface = await read("components/command-surface.tsx");
const commandDashboard = await read("lib/command-dashboard.ts");
const qrRoute = await read("app/api/qr/route.ts");

requireContract(teamRoute, /hasCapability\(context, "authority\.read"\)/, "team read capability gate");
requireContract(teamRoute, /hasCapability\(context, "authority\.manage"\)/, "team write capability gate");
requireContract(teamRoute, /eq\(s04Records\.tenantId, tenantId\)/, "team tenant-scoped readback");
requireContract(teamRoute, /eq\(tenantMemberships\.tenantId, context\.tenantId\)/, "team member tenant boundary");
requireContract(teamRoute, /memberIds: invalidMemberIds|team_membership_not_active/, "team active membership validation");
requireContract(teamRoute, /authority\.team\.created/, "team event ledger");
requireContract(teamRoute, /zerow\.authority\.team\.created/, "team outbox publication");
requireContract(teamRoute, /SITES_READBACK_VERIFIED/, "team reconciliation readback");
requireContract(teamRoute, /source: "sites-d1-authority-team-readback"/, "team response readback source");
requireContract(onboarding, /fetch\("\/api\/authority\/teams"/, "team UI server readback");
requireContract(onboarding, /fetch\("\/api\/authority\/teams",\s*\{\s*method: "POST"/, "team UI create action");
requireContract(onboarding, /Crea squadra/, "team create control");
requireContract(onboarding, /teamMemberIds\.length/, "team UI requires real members");

requireContract(resourceLibrary, /jobJourneyRecords/, "planning active plan source");
requireContract(resourceLibrary, /eq\(jobJourneyRecords\.status, "PUBLISHED"\)/, "only published plans reserve resources");
requireContract(resourceLibrary, /readAllById/, "planning catalogs and reservations read beyond the first page");
requireContract(resourceLibrary, /gt\(jobJourneyRecords\.id, afterId\)/, "planning ledgers use stable keyset pagination");
requireContract(resourceLibrary, /gt\(s04Records\.id, afterId\)/, "resource catalogs use stable keyset pagination");
requireContract(resourceLibrary, /availableForWindow/, "planning server availability field");
requireContract(resourceLibrary, /overlaps\(window, assignment\)/, "planning server interval overlap");
requireContract(missionResourceLibrary, /readAllById/, "mission catalogs read beyond the first page");
requireContract(missionResourceLibrary, /gt\(jobJourneyRecords\.id, afterId\)/, "mission assignments use stable keyset pagination");
requireContract(missionResourceLibrary, /gt\(s04Records\.id, afterId\)/, "mission resources use stable keyset pagination");
requireContract(missionResourceLibrary, /row\.domain === "planning" && status !== "PUBLISHED"/, "draft plans do not reserve mission resources");
requireContract(missionResourceFields, /const selectableVehicles = useMemo\(\(\) => [^\n]*\?\? \[\]/, "mission form safely renders before the server vehicle catalog loads");
requireContract(resourceRoute, /searchParams\.get\("startsAt"\)/, "planning start window query");
requireContract(resourceRoute, /searchParams\.get\("endsAt"\)/, "planning end window query");
requireContract(resourceRoute, /unavailableForWindow/, "planning unavailable readback");
requireContract(resourceRoute, /server-window-lifecycle-role-profile-and-published-plans/, "planning server guard contract");
requireContract(resourceRoute, /Drafts do not reserve resources/, "draft plans do not block resource availability");
requireContract(resourceFields, /startsAt: string/, "planning UI start prop");
requireContract(resourceFields, /endsAt: string/, "planning UI end prop");
requireContract(resourceFields, /params\.set\("startsAt"/, "planning UI sends start window");
requireContract(resourceFields, /params\.set\("endsAt"/, "planning UI sends end window");
requireContract(resourceFields, /disabled=\{!available\}/, "planning UI blocks occupied resources");
requireContract(planningOverviewRoute, /readAllById/, "planning overview reads all tenant pages");
requireContract(planningOverviewRoute, /gt\(jobJourneyRecords\.id, afterId\)/, "planning readback paginates event and plan ledgers");
requireContract(planningOverviewRoute, /gt\(s04Records\.id, afterId\)/, "planning readback paginates server catalogs");
requireContract(planningSurface, /<PlanningResourceFields[\s\S]*?startsAt=\{startsAt\}/, "planning editor passes start window");
requireContract(planningSurface, /<PlanningResourceFields[\s\S]*?endsAt=\{endsAt\}/, "planning editor passes end window");
requireContract(resourceFields, /resource-options\$\{query \? `\?\$\{query\}` : ""\}/, "planning resource selector queries server availability");
requireContract(planningWriteRoute, /resolvePlanningResources/, "planning server canonical resource resolution");
requireContract(planningWriteRoute, /evaluateAgainstTenant/, "planning server tenant conflict evaluation");
requireContract(communicationsSurface, /CommandMobileNav active="communications"/, "operational navigation in communications");
requireContract(communicationsSurface, /getAllowedCommandNavigation\(capabilities\)/, "communications navigation is capability filtered");
requireContract(settingsSurface, /CommandMobileNav active="settings"/, "operational navigation in settings");
requireContract(commandMapRoute, /MAP_READ_PAGE_SIZE/, "control map pages all canonical records");
requireContract(commandMapRoute, /max\(locationSamples\.recordedAt\)/, "control map reads the latest GPS point per vehicle");
requireContract(qrRoute, /resolveCatalogEntity\(/, "QR identities are resolved from server-side tenant catalogs");
requireContract(qrRoute, /eq\(s04Records\.tenantId, tenantId\)/, "QR asset and commessa lookup is tenant scoped");
requireContract(qrRoute, /eq\(inventoryItems\.tenantId, tenantId\)/, "QR material lookup is tenant scoped");
requireContract(qrRoute, /eq\(tenantWarehouses\.tenantId, tenantId\)/, "QR warehouse lookup is tenant scoped");
requireContract(qrRoute, /catalog_entity_not_found/, "QR rejects missing catalog entities instead of verifying ghosts");
requireContract(qrRoute, /parseJobPayload\(record\.payloadJson\)/, "QR commessa labels use the commercial payload");
requireContract(commandMapRoute, /eq\(trackingSessions\.status, "ACTIVE"\)/, "control map only reads positions from active attendance tracking sessions");
requireContract(commandMapRoute, /eq\(locationSamples\.trackingSessionId, sample\.trackingSessionId\)/, "control map cannot mix a prior tracking session position into the current session");
requireContract(commandMapRoute, /eq\(geoLocations\.status, "TEMPORARY"\)/, "control map reads explicitly temporary mission places");
requireContract(commandMapRoute, /temporaryPlaces: temporaryStops/, "control map returns temporary delivery stops separately from canonical locations");
requireContract(commandMapRoute, /eq\(routePlans\.tenantId, context\.tenantId\)/, "control map scopes route readback to the current tenant");
requireContract(operationalMapSurface, /setInterval\(refreshWhenVisible, 15_000\)/, "control map refreshes live readback every 15 seconds while visible");
requireContract(operationalMapSurface, /value="MISSIONI">Missioni/, "control map offers a dedicated mission filter");
requireContract(operationalMapSurface, /TAPPA TEMPORANEA/, "control map distinguishes temporary stop details");
requireContract(operationalMapSurface, /MEZZO IN TRACKING/, "control map exposes selected driver vehicle tracking details");

requireContract(commandAnalyticsRoute, /hasCapability\(context, "analytics\.read"\)/, "Command analytics capability gate");
requireContract(commandAnalyticsRoute, /hasCapability\(context, "command\.read"\)/, "Command analytics page capability gate");
requireContract(commandAnalyticsRoute, /eq\(s06Events\.tenantId, context\.tenantId\)/, "Command analytics tenant boundary");
requireContract(commandAnalyticsRoute, /groupBy\(dayBucket\)/, "Command analytics server-side daily aggregation");
requireContract(commandAnalyticsRoute, /rawPayloadIncluded: false/, "Command analytics excludes raw event payloads");
assert(!/s06Events\.(payloadJson|actorId)/.test(commandAnalyticsRoute), "Command analytics must not read raw payload or actor identity");
requireContract(commandSurface, /\/api\/command\/analytics\?days=\$\{period\}/, "Command analytics reads its server aggregate endpoint");
requireContract(commandSurface, /payload\.liveRequest === "VERIFIED"/, "Company AI separates provider verification from configuration");
requireContract(commandSurface, /assistantRequestRef\.current\?\.prompt === prompt/, "Company AI reuses the idempotency key for uncertain retries");
requireContract(commandSurface, /readback\?\.status !== "ok"/, "Company AI confirms the server ledger before showing success");
assert(!commandSurface.includes("OPENAI LIVE") && !commandSurface.includes("NewJobDialog"), "Command must not overstate AI liveness or expose a local-only job creation action");
requireContract(commandReadinessRoute, /const checks = \[/, "Command readiness reports named checks");
assert(!/localGateTotal\s*=\s*6/.test(commandReadinessRoute), "Command readiness must not publish a hardcoded readiness score");
requireContract(commandDashboard, /anyCapabilities\.some\(/, "Command widgets support server-compatible alternative capability gates");
requireContract(commandDashboard, /requiredCapabilities: \["command\.read", "communication\.read"\]/, "Reminder widget requires communication access");

requireContract(authorityContext, /context\.tenantId/, "authority tenant context");
requireContract(authorityContext, /assertTenantScope/, "authority tenant assertion");
requireContract(authorityCatalog, /ROLE_CAPABILITIES/, "canonical capability catalog");
requireContract(authorityContext, /normalizeAuthorityRoles/, "multi-role context normalization");
requireContract(authorityContext, /roles.flatMap/, "multi-role capability union");
requireContract(authorityCatalog, /warehouse\.register/, "warehouse registration capability");
requireContract(membershipRoute, /rolesJson: authorityRolesJson/, "multi-role membership persistence");
requireContract(membershipRoute, /action === "set_role" \|\| action === "set_roles"/, "multi-role membership update");
requireContract(membershipRoute, /target\.actorId === context\.actorId/ , "self-role change boundary");
requireContract(membershipRoute, /requestedRoles\.includes\("owner"\)/, "owner authority preservation");
requireContract(warehouseRoute, /operation === "manage" \? "warehouse\.register"/, "warehouse domain capability gate");
requireContract(warehouseRoute, /latitudeE6: Math\.round/, "server coordinate normalization");
requireContract(warehouseRoute, /geofenceRadiusMeters/, "warehouse geofence persistence");
requireContract(warehouseRoute, /warehouse\.location\.created/, "warehouse location event ledger");
requireContract(warehouseRoute, /zerow\.warehouse\.location\.created/, "warehouse location outbox");
requireContract(warehouseRoute, /SITES_READBACK_VERIFIED/, "warehouse location reconciliation");
requireContract(warehouseCatalogRoute, /INVENTORY_UNIT_CATALOG/, "server unit catalog");
requireContract(warehouseCatalogRoute, /tenantWarehouseAccess/, "tenant warehouse catalog readback");
requireContract(inventoryRoute, /hasCapability\(context, "warehouse\.register"\)/, "material registration capability gate");
const registrationGateIndex = inventoryRoute.indexOf('if (action === "register_item" && !hasCapability(context, "warehouse.register"))');
const inventoryIdempotencyIndex = inventoryRoute.indexOf("const [existingEvent]");
assert(registrationGateIndex >= 0 && registrationGateIndex < inventoryIdempotencyIndex, "material registration capability must be checked before idempotent readback");
requireContract(inventoryRoute, /unit_must_be_selected_from_catalog/, "material unit catalog validation");
requireContract(inventoryRoute, /warehouse_not_found_or_inactive/, "material warehouse validation");
requireContract(jobJourneyRoute, /async function materialCatalogOptions\(context: AuthorityContext\)/, "job material choices come from the server catalog");
requireContract(jobJourneyRoute, /eq\(inventoryItems\.tenantId, context\.tenantId\)/, "job material catalog is tenant scoped");
requireContract(jobJourneyRoute, /material_catalog_selection_unavailable/, "job material selection is revalidated on write");
requireContract(jobJourneyRoute, /description: item\.name/, "job material name is resolved from canonical inventory");
requireContract(jobJourneyRoute, /directPickupQuantity/, "warehouse approval accepts a per-line direct pickup allocation");
requireContract(jobJourneyRoute, /missionDeliveryMilli: approvedQuantityMilli - directPickupMilli/, "approved line quantity is split exactly between pickup and delivery");
requireContract(jobJourneyRoute, /missionDeliveryEnabled[\s\S]*?DIRECT_PICKUP_ONLY/, "no-transport profiles are forced server-side to direct pickup");
requireContract(jobJourneyRoute, /fulfillmentPlan:\s*\{\s*version: 1/, "approved material split is persisted server-side");
requireContract(jobJourneyRoute, /material_request_has_no_mission_delivery/, "direct-only requests cannot create an empty delivery mission");
requireContract(materialFulfillment, /missionDeliveryMilli = approvedQuantityMilli/, "legacy approved requests remain mission-delivery compatible");
requireContract(materialFulfillment, /directPickupMilli \+ missionDeliveryMilli !== approvedQuantityMilli/, "split readback rejects unbalanced quantities");
requireContract(materialFulfillment, /plan\.allocationMethod !== "LINE_QUANTITY"/, "split readback validates its allocation contract version");
requireContract(materialPickupRoute, /hasCapability\(context, "warehouse\.self_pickup"\)/, "direct pickup has a dedicated capability gate");
requireContract(materialPickupRoute, /isActorAssignedToJob\(\{ context, job, planningRows, workforceRows, missionRows \}\)/, "direct pickup requires a server-verified commessa assignment");
requireContract(materialPickupRoute, /evaluateAttendanceGeofence\(location, geofence\)/, "direct pickup validates the warehouse geofence server-side");
requireContract(materialPickupRoute, /quantityMilli > remainingMilli/, "direct pickup cannot exceed its allocated line quantity");
requireContract(materialPickupRoute, /reservedMilli: nextReserved/, "direct pickup decrements its reservation with physical stock");
requireContract(materialPickupRoute, /'MATERIAL_PICKUP'/, "direct pickup writes its own append-only warehouse record");
requireContract(materialPickupRoute, /warehouse\.material_pickup\.recorded/, "direct pickup publishes an S06 audit event");
requireContract(materialPickupRoute, /SITES_READBACK_VERIFIED/, "direct pickup verifies ledger, outbox and reconciliation readback");
requireContract(materialPickupRoute, /jobStockMovements/, "direct pickup appends a commessa stock movement");
requireContract(materialPickupRoute, /job_stock_balances[\s\S]*?ON CONFLICT/, "direct pickup atomically projects the commessa stock balance");
requireContract(materialPickupRoute, /warehouse\.job_stock\.received/, "direct pickup publishes the commessa stock event");
requireContract(jobJourneyRoute, /sourceType: "MISSION_DELIVERY"/, "warehouse-to-job unload credits the commessa stock register");
requireContract(jobJourneyRoute, /mission_job_stock_readback_unavailable/, "mission delivery fails closed when commessa stock readback is incomplete");
requireContract(jobStockRoute, /hasCapability\(context, "warehouse\.read"\)/, "commessa stock readback has a warehouse capability gate");
requireContract(jobStockRoute, /eq\(jobStockRegisters\.tenantId, context\.tenantId\)/, "commessa stock register is tenant scoped");
requireContract(jobStockRoute, /rowMatchesContext\(job, context, teamScopeTokens/, "commessa stock visibility follows operational assignment scope");
requireContract(jobStockRoute, /operations\.rapportino\.write/, "shift stock reconciliation is available only to a rapportino-authorized responsible");
requireContract(jobStockRoute, /operatingDomains\.includes\("warehouse"\)/, "shift stock reconciliation is disabled outside the tenant warehouse domain");
requireContract(jobStockRoute, /job_stock_reconciliation_catalog_changed/, "shift reconciliation fails closed when the server catalog changes");
requireContract(jobStockRoute, /inventoryUnitForCode/, "shift consumption respects the server-owned unit precision catalog");
requireContract(jobStockRoute, /movementType: "CONSUME"/, "confirmed shift consumption appends a negative commessa-stock movement");
requireContract(jobStockRoute, /registerVersionAfter/, "a shift reconciliation is bound to one exact register snapshot");
requireContract(jobStockRoute, /warehouse\.job_stock\.shift_reconciled/, "shift reconciliation publishes its governed ledger event");
requireContract(jobStockRoute, /outboxReadback[\s\S]*?auditReadback/, "shift reconciliation verifies event, outbox and audit readback");
requireContract(operationsJobRoute, /job_stock_reconciliation_required/, "rapportino submission requires current commessa-stock reconciliation when balances remain");
requireContract(operationsRoute, /db\.insert\(jobStockRegisters\)/, "commessa creation provisions its stock register in the same batch");
requireContract(operationsRoute, /job_stock_register_readback_unavailable/, "commessa creation verifies the stock register readback");
requireContract(jobStockMigration, /INSERT OR IGNORE INTO `job_stock_registers`/, "existing commesse receive an idempotent stock-register backfill");
requireContract(jobStockMigration, /'MISSION_DELIVERY'/, "existing warehouse-to-job deliveries are projected into commessa stock");
requireContract(operationsJobSurface, /MAGAZZINO DI COMMESSA/, "commessa dossier exposes its server-side stock register");
requireContract(operationsJobSurface, /\/stock`/, "commessa stock card reads the dedicated endpoint");
requireContract(operationsJobSurface, /Conferma consumi del turno/, "rapportino exposes the end-of-shift stock reconciliation on mobile");
requireContract(genericModuleRoute, /transport_domain_not_enabled/, "asset creation cannot enable transport outside the tenant operating profile");
requireContract(assetProfileRoute, /transport_domain_not_enabled/, "asset profile updates cannot enable transport outside the tenant operating profile");
requireContract(operatingModel, /OPERATIONS_WAREHOUSE/, "onboarding exposes operations plus warehouse without transport");
requireContract(attendanceRoute, /directPickupsByJob/, "Presenze exposes only pending pickups for assigned commesse");
requireContract(attendanceRoute, /GROUP BY requestId, lineId/, "Presenze totals every immutable pickup event without a history-page cap");
requireContract(attendanceSurface, /\/material-pickup/, "Presenze records pickup through the server route");
requireContract(attendanceSurface, /readPickupLocation\(\)/, "pickup obtains an on-demand device position");
requireContract(warehouseRequestsRoute, /directPickups:/, "warehouse queue reads direct pickup history from the ledger");
requireContract(warehouseRequestsRoute, /GROUP BY job_id, requestId, lineId/, "warehouse queue receives complete server-side pickup totals despite bounded event details");
requireContract(warehouseQueueSurface, /missionDeliveryLines\(request\.payload\)/, "warehouse mission controls use only the delivery allocation");
requireContract(warehouseQueueSurface, /quota consegnata viene programmata in Missioni/, "warehouse UI explains the coexisting pickup and delivery paths");
requireContract(warehouseQueueSurface, /missionDeliveryEnabled/, "warehouse approval adapts to the server operating profile");
requireContract(missionCommandSurface, /missionDeliveryLines\(request\.payload\)/, "Missioni receives only its allocated delivery quantities");
requireContract(materialFulfillmentTests, /legacy compatibility and mission-only quantities: PASS/, "fulfillment split regression tests cover mixed, direct-only and legacy requests");
requireContract(jobJourneySurface, /name="itemId"/, "job material UI selects a server catalog item");
requireContract(jobJourneySurface, /materialCatalog \?\? \[\]\)\.map\(\(item\)/, "job material UI reads server catalog options");
assert(!jobJourneySurface.includes('name="description"') && !jobJourneySurface.includes('field(form, "description")'), "job material requests must not accept free-text item names");
requireContract(inventoryRoute, /storageShelf/, "material storage shelf persistence");
requireContract(inventoryRoute, /barcode/, "material barcode binding");
requireContract(inventoryRoute, /qrCode/, "server QR binding");
requireContract(inventoryRoute, /findItemByIdentifier/, "server identifier resolution");
requireContract(inventoryRoute, /inventory_identifier_not_found/, "unknown scan fails closed");
requireContract(warehouseControl, /fetch\("\/api\/warehouse\/catalog"/, "warehouse UI catalog readback");
requireContract(warehouseControl, /name="warehouseId"/, "warehouse UI server warehouse selector");
requireContract(warehouseControl, /name="unit"/, "warehouse UI server unit selector");
requireContract(warehouseControl, /WarehouseCodeScanner/, "warehouse local barcode and QR scanner");
requireContract(warehouseControl, /Scansiona sul posto/, "movement scan-first path");
requireContract(warehouseControl, /Catalogo da remoto/, "movement remote catalog path");
requireContract(warehouseControl, /name="shelf"/, "warehouse shelf field");
requireContract(warehouseComponent, /fetch\("\/api\/authority\/warehouses"/, "onboarding warehouse readback");
requireContract(legacyS04Page, /module === "warehouse"\)\s*\{\s*router\.push\("\/warehouse"\)/, "legacy warehouse CTA redirects to canonical module");
requireContract(legacyS04Page, /module === "assets" && createOpen && <ServerNamingDialog module="assets"/, "legacy S04 naming dialog restricted to assets");
assert.doesNotMatch(legacyS04Page, /ServerNamingDialog module=\{module\}/, "legacy S04 must not mount a warehouse naming dialog");
assert.equal((assetNamingDialog.match(/Registra materiale/g) ?? []).length, 0, "asset naming dialog must not contain warehouse registration copy");
requireContract(genericS04Route, /warehouse_material_registration_moved_to_inventory/, "legacy generic warehouse material write blocked");
requireContract(genericS04Route, /status: 410/, "legacy generic warehouse material write returns gone");

const sourceFiles = [
  ...(await walk(path.join(root, "app"))),
  ...(await walk(path.join(root, "components"))),
];
const buttonInventory = [];
const suspiciousButtons = [];
for (const file of sourceFiles) {
  const source = await fs.readFile(file, "utf8");
  // Do not stop at the `>` in an inline arrow (`onClick={() => ...}`).
  // This is intentionally a conservative inventory scan, not a JSX parser.
  for (const match of source.matchAll(/<(button|Button)\b([\s\S]*?)(?<![=])>/g)) {
    const attributes = match[2];
    const relative = path.relative(root, file);
    const hasClick = /\bonClick\s*=/.test(attributes);
    const isSubmit = /\btype\s*=\s*(?:["']submit["']|\{\s*["']submit["']\s*\})/.test(attributes);
    const isLink = /\bhref\s*=|\basChild\b/.test(attributes);
    const classification = hasClick ? "click-bound" : isSubmit ? "form-bound" : isLink ? "navigation-bound" : "unbound-or-declarative";
    buttonInventory.push({ file: relative, tag: match[1], classification });
    const wrapperBound = /DialogClose\s+asChild|DropdownMenuTrigger\s+asChild|DropdownMenuItem/.test(source);
    if (classification === "unbound-or-declarative" && !wrapperBound) suspiciousButtons.push({ file: relative, tag: match[1] });
  }
}

// Declarative buttons are allowed only when they are part of an explicitly
// inspected static surface. Keep the list visible in CI output instead of
// pretending a source scan is equivalent to an authenticated click test.
const allowedDeclarative = new Set([
  "components/ui/button.tsx",
  "components/ui/dialog.tsx",
  "components/ui/tabs.tsx",
  "components/ui/tooltip.tsx",
  "components/ui/attachment.tsx",
  "components/ui/calendar.tsx",
  "components/ui/combobox.tsx",
  "components/ui/input-group.tsx",
  "components/ui/message-scroller.tsx",
]);
const unexplainedButtons = suspiciousButtons.filter((item) => !allowedDeclarative.has(item.file));

const runtimeUrl = (process.env.ZEROW_RUNTIME_URL || "").replace(/\/$/, "");
let runtime = { status: "NOT_RUN", reason: "ZEROW_RUNTIME_URL not supplied" };
if (runtimeUrl) {
  const paths = ["/", "/api/authority/teams", "/api/authority/warehouses", "/api/warehouse/catalog", "/api/warehouse/inventory", "/api/operations/jobs/unknown/planning/resource-options"];
  const results = [];
  for (const route of paths) {
    const response = await fetch(`${runtimeUrl}${route}`, { redirect: "manual" });
    results.push({ route, status: response.status });
  }
  assert.equal(results.find((item) => item.route === "/api/authority/teams")?.status, 401, "team API must fail closed without identity");
  assert.equal(results.find((item) => item.route === "/api/authority/warehouses")?.status, 401, "warehouse onboarding API must fail closed without identity");
  assert.equal(results.find((item) => item.route === "/api/warehouse/catalog")?.status, 401, "warehouse catalog API must fail closed without identity");
  assert.equal(results.find((item) => item.route === "/api/warehouse/inventory")?.status, 401, "inventory API must fail closed without identity");
  assert.equal(results.find((item) => item.route === "/api/operations/jobs/unknown/planning/resource-options")?.status, 401, "planning resource API must fail closed without identity");
  runtime = { status: "PASS", baseUrl: runtimeUrl, unauthenticatedBoundary: results };
}

console.log(JSON.stringify({
  status: unexplainedButtons.length === 0 ? "PASS_WITH_AUTHENTICATED_GATE" : "FAIL_UNBOUND_BUTTON_SURFACE",
  contracts: {
    authorityTeams: "PASS",
    planningAvailability: "PASS",
    controlMapDriverTracking: "PASS",
    temporaryMissionPlaces: "PASS",
    commandAnalytics: "PASS",
    companyAiRuntimeTruth: "PASS",
    commandSurfaceActions: "PASS",
    tenantAndRoleGuards: "PASS",
    readbackLedger: "PASS",
    qrCatalogResolution: "PASS",
    splitWarehouseFulfillment: "PASS",
  },
  interactions: {
    buttonsScanned: buttonInventory.length,
    suspiciousButtons: unexplainedButtons,
    criterion: "click-bound, form-bound or navigation-bound; declarative primitives excluded only when explicitly allow-listed",
  },
  runtime,
  authenticatedE2E: {
    status: "NOT_RUN",
    reason: "Requires a real authenticated owner/member session; source and unauthenticated fail-closed boundaries are verified separately.",
    journeys: [
      "authority team create → D1 s04 → s06 event/outbox/reconciliation → team GET readback",
      "warehouse create → server coordinate/geofence validation → D1 location readback",
      "warehouse manager register material → unit/warehouse catalog → append-only inventory readback",
      "approved warehouse reservation → direct pickup or delivery mission → one shared commessa stock ledger",
      "warehouse operator movement allowed → material registration denied by warehouse.register",
      "multi-role membership → unioned capabilities → tenant-scoped access",
      "planning window → server resource-options → occupied resource disabled → planning write guard",
      "active driver attendance session → live control map → temporary mission stop/geofence → removed from operational map at route/mission close",
      "role capability deny/allow → tenant A/B isolation",
    ],
  },
}, null, 2));
