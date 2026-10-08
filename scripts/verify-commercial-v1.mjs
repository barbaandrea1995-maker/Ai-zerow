import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { AUTHORITY_ROLES, ROLE_CAPABILITIES, normalizeAuthorityRoles } from "../lib/authority-catalog.ts";
import {
  COMMAND_WIDGET_CATALOG,
  defaultCommandWidgetLayout,
  getAllowedCommandNavigation,
  sanitizeCommandWidgetLayout,
} from "../lib/command-dashboard.ts";
import { RELEASE_BUILD_ID } from "../lib/release.ts";
import { evaluatePlanning, normalizePlanningResource, normalizePlanningSlot } from "../lib/planning-contract.ts";
import { documentCanDownload, transitionDocumentSecurity } from "../lib/document-security.ts";
import {
  MISSION_POD_EVIDENCE_TYPES,
  missionPodEvidenceComplete,
  normalizeMissionPodEvidence,
} from "../lib/mission-pod-contract.ts";
import {
  MISSION_EXCEPTION_TYPES,
  missionExceptionIsOpen,
  normalizeMissionException,
} from "../lib/mission-exception-contract.ts";
import { transitionOutbox } from "../lib/outbox-contract.ts";
import { transitionW10Workflow, w10ExternalStatus, w10Progress } from "../lib/w10-contract.ts";
import {
  OPERATING_PROFILE_CATALOG,
  TRANSPORT_MODE_CATALOG,
  filterCapabilitiesForDomains,
  transportModesForProfile,
} from "../lib/tenant-operating-model.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
assert.equal(packageJson.scripts["verify:runtime"], "node scripts/verify-runtime-smoke.mjs", "Runtime smoke verification must remain runnable from the package scripts");
assert.equal(packageJson.scripts["audit:release"], "node scripts/audit-release-surface.mjs", "Release surface audit must remain runnable from the package scripts");
assert.equal(packageJson.scripts["audit:e2e"], "node scripts/audit-e2e-contract.mjs", "E2E contract audit must remain runnable from the package scripts");
assert.equal(packageJson.scripts["audit:ui"], "node scripts/audit-ui-alignment.mjs", "UI alignment audit must remain runnable from the package scripts");
const runtimeSmoke = await readFile(join(root, "scripts", "verify-runtime-smoke.mjs"), "utf8");
assert(runtimeSmoke.includes("protected_api_fail_closed") && runtimeSmoke.includes("service_worker_build_binding"), "Runtime smoke must cover auth boundaries and PWA build binding");
const surfaceAudit = await readFile(join(root, "scripts", "audit-release-surface.mjs"), "utf8");
assert(surfaceAudit.includes("unresolvedApiEndpoints") && surfaceAudit.includes("browserGpsApi"), "Release surface audit must cover endpoint bindings and GPS/map integration status");
const e2eAudit = await readFile(join(root, "scripts", "audit-e2e-contract.mjs"), "utf8");
assert(e2eAudit.includes("authenticatedE2E") && e2eAudit.includes("suspiciousButtons"), "E2E audit must keep authenticated gates and button inventory explicit");
const uiAudit = await readFile(join(root, "scripts", "audit-ui-alignment.mjs"), "utf8");
assert(uiAudit.includes("commercial-modules.json") && uiAudit.includes("globalFallbackContract"), "UI audit must cover the canonical module registry and global action fallback");
const missionJourneyRoute = await readFile(join(root, "app", "api", "operations", "jobs", "[jobId]", "journey", "route.ts"), "utf8");
assert(missionJourneyRoute.includes("mission_stop_not_current") && missionJourneyRoute.includes("mission_stop_arrival_required"), "Mission cargo actions must be constrained to the server-side current geofenced stop");
assert(missionJourneyRoute.includes("mission_route_required_for_cargo_action") && missionJourneyRoute.includes("routeStopSupportsAction"), "Mission cargo actions must require a canonical route and compatible stop action");
assert(missionJourneyRoute.includes("mission_stop_asset_set_incomplete") && missionJourneyRoute.includes("routeStopCargoAssetIds") && missionJourneyRoute.includes("requestedCargoAssetIds"), "Mission cargo actions must preserve the complete asset set declared by the route stop");
assert(missionJourneyRoute.includes("missionMaterialLinesForRouteStop") && missionJourneyRoute.includes("routeStopMaterialActionEntries"), "Mission inventory effects must be scoped to the material lines declared by the current route stop");
assert(missionJourneyRoute.includes("mission_material_line_not_reconcilable") && missionJourneyRoute.includes("mission_material_quantity_invalid"), "Mission inventory effects must reject route-stop material lines or quantities that cannot be reconciled with the request snapshot");
const missionLocationIngest = await readFile(join(root, "lib", "location-intelligence", "ingest.ts"), "utf8");
assert(missionLocationIngest.includes("stop.status !== \"DEPARTED\" && !stop.departedAt") && missionLocationIngest.includes("Boolean(stop.departedAt)"), "Location ingestion must keep a delivered stop attached until physical departure is observed");
const missionDeck = await readFile(join(root, "components", "mission-command-deck.tsx"), "utf8");
assert(missionDeck.includes("currentRouteStopView") && missionDeck.includes("Tappa corrente server-side"), "Mission UI must expose and enforce the server-side current stop");
assert(missionDeck.includes("requestMaterialLineActions") && missionDeck.includes("firstLoadStopIndex") && missionDeck.includes("lastUnloadStopIndex") && missionDeck.includes("MaterialStopAssignmentList") && missionDeck.includes("materialQuantities"), "Mission UI must assign material lines and cargo assets to the correct route legs");
assert(missionDeck.includes("cargoManifest") && missionDeck.includes("MANIFESTO TAPPA CORRENTE") && missionDeck.includes("cargoManifestProgress"), "Mission UI must expose the server-side cargo manifest and its per-stop readback");
assert(missionDeck.includes("manifestEventForEntry") && missionDeck.includes("Evento effettivo"), "Mission UI must expose the timestamped action evidence for the selected route stop");
assert(missionDeck.includes("AssetStopAssignmentList") && missionDeck.includes("selectedCargoAssetIds") && missionDeck.includes("cargoAssetIds"), "Mission UI must assign multiple real assets to individual route stops");
assert(missionJourneyRoute.includes("cargoAssetIds") && missionJourneyRoute.includes("assetIds: actionAssetIds") && missionJourneyRoute.includes("assetIds: deliveryAssetIds"), "Mission actions must preserve multiple asset identities in server readback");
assert(missionJourneyRoute.includes("planningPlanId") && missionJourneyRoute.includes("planning_plan_already_linked") && missionJourneyRoute.includes("mission_plan_resource_mismatch"), "Mission creation from planning must be server-linked, idempotent and resource-validated");
assert(missionDeck.includes("useSearchParams") && missionDeck.includes("activePlanningPlanId") && missionDeck.includes("openCreate(null, handoff)"), "Mission UI must accept a published planning handoff and preserve its reference");

assert.equal(AUTHORITY_ROLES.length, 14, "The canonical role catalog must contain 14 roles");
assert.equal(new Set(AUTHORITY_ROLES).size, AUTHORITY_ROLES.length, "Role IDs must be unique");
assert.equal(new Set(COMMAND_WIDGET_CATALOG.map((widget) => widget.id)).size, COMMAND_WIDGET_CATALOG.length, "Widget IDs must be unique");
assert(COMMAND_WIDGET_CATALOG.some((widget) => widget.id === "finance-procurement" && widget.requiredCapabilities.includes("finance.read") && widget.requiredCapabilities.includes("procurement.read")), "W10 Command widget must require both Finance and Procurement read capabilities");
assert(COMMAND_WIDGET_CATALOG.some((widget) => widget.id === "planning-overview" && widget.requiredCapabilities.includes("planning.read")), "Command must expose a capability-filtered planning widget");
assert(COMMAND_WIDGET_CATALOG.some((widget) => widget.id === "attendance-overview" && widget.requiredCapabilities.includes("workforce.read")), "Command must expose a capability-filtered attendance widget");

const planningResource = normalizePlanningResource({ id: "team-alpha", kind: "team", label: "Team Alpha", capacity: 1, qualifications: ["idraulica"] });
const planningSlot = normalizePlanningSlot({ id: "slot-a", startsAt: "2026-10-03T08:00:00Z", endsAt: "2026-10-03T12:00:00Z", resourceIds: ["team-alpha"], requiredQualifications: ["idraulica"] });
assert(planningResource && planningSlot, "Planning fixtures must normalize");
const planningPass = evaluatePlanning([planningSlot], [planningResource]);
assert(planningPass.feasible, "A qualified resource must produce a feasible planning slot");
const planningConflict = evaluatePlanning([
  planningSlot,
  { ...planningSlot, id: "slot-b", startsAt: "2026-10-03T10:00:00Z", endsAt: "2026-10-03T13:00:00Z" },
], [planningResource]);
assert(planningConflict.conflicts.some((conflict) => conflict.code === "RESOURCE_OVERLAP"), "Planning must detect overlapping resource usage");

const outboxRetry = transitionOutbox({ status: "PENDING_EXTERNAL_CONSUMER", attempts: 0, action: "retry" });
assert.equal(outboxRetry.nextStatus, "PENDING_EXTERNAL_CONSUMER", "Outbox retry must remain pending until an external consumer proves delivery");
assert.equal(outboxRetry.nextAttempts, 1, "Outbox retry must increment attempts");
assert.equal(transitionOutbox({ status: "PENDING_EXTERNAL_CONSUMER", attempts: 4, action: "retry" }).nextStatus, "DEAD_LETTERED", "Outbox retry budget must terminate in DLQ");
assert.throws(() => transitionOutbox({ status: "DELIVERED", attempts: 1, action: "retry" }), /outbox_terminal_status/, "Delivered outbox rows must not be replayed by Sites");

const documentPending = transitionDocumentSecurity({
  scanStatus: "NOT_RUN",
  documentStatus: "AVAILABLE_UNSCANNED",
  action: "queue_scan",
});
const documentClean = transitionDocumentSecurity({
  scanStatus: documentPending.scanStatus,
  documentStatus: documentPending.documentStatus,
  action: "provider_result",
  providerResult: "CLEAN",
});
assert.equal(documentClean.documentStatus, "AVAILABLE_CLEAN", "Only provider CLEAN may release a document");
assert(!documentCanDownload("NOT_RUN", "AVAILABLE_UNSCANNED"), "Unscanned documents must remain blocked");
assert(documentCanDownload("CLEAN_PROVIDER", "AVAILABLE_CLEAN"), "Provider-clean documents must be downloadable");
assert.throws(() => transitionDocumentSecurity({
  scanStatus: "NOT_RUN",
  documentStatus: "AVAILABLE_UNSCANNED",
  action: "release",
}), /document_release_requires_provider_clean/, "Manual release must not bypass provider evidence");

assert.equal(MISSION_POD_EVIDENCE_TYPES.length, 6, "Mission POD must expose the canonical six evidence types");
const driverEvidence = normalizeMissionPodEvidence({ evidenceType: "AUTHORIZED_DRIVER_CONFIRMATION" }, "2026-10-05T12:00:00.000Z", "actor-1");
assert(driverEvidence.evidence && missionPodEvidenceComplete(driverEvidence.evidence), "Authorized driver confirmation must normalize into a complete POD evidence");
assert.equal(normalizeMissionPodEvidence({ evidenceType: "BARCODE_OR_QR_CONFIRMATION" }, "2026-10-05T12:00:00.000Z", "actor-1").error, "pod_evidence_reference_required", "Barcode/QR POD must carry a reference");
assert.equal(normalizeMissionPodEvidence({ evidenceType: "DELIVERY_PHOTO" }, "2026-10-05T12:00:00.000Z", "actor-1").error, "pod_evidence_document_required", "Photo POD must link a document");
assert.equal(normalizeMissionPodEvidence({ evidenceType: "DDT_SCANNED", evidenceReference: "DDT-42", documentId: "DOC-42" }, "2026-10-05T12:00:00.000Z", "actor-1").evidence?.type, "DDT_SCANNED", "DDT evidence must preserve its canonical type");
assert.equal(MISSION_EXCEPTION_TYPES.length, 8, "Mission exceptions must expose the canonical recovery set");
const delayException = normalizeMissionException({ exceptionType: "DELAYED", note: "Traffico intenso" }, "2026-10-05T12:01:00.000Z", "actor-1");
assert(delayException.exception && missionExceptionIsOpen(delayException.exception), "Mission exception must be server-normalized as open evidence");
assert.equal(normalizeMissionException({ exceptionType: "BLOCKED" }, "2026-10-05T12:01:00.000Z", "actor-1").error, "mission_exception_note_required", "Mission exception must require an operational note");

const procurementReview = transitionW10Workflow({ module: "procurement", status: "REQUESTED", action: "submit_review" });
assert.equal(procurementReview.nextStatus, "REVIEW", "Procurement must move into review before approval");
const procurementApproval = transitionW10Workflow({ module: "procurement", status: "REVIEW", action: "approve" });
assert(procurementApproval.requiresApproval, "Procurement approval must require approvals.review");
const procurementExternalIssue = transitionW10Workflow({ module: "procurement", status: "PO_DRAFT", action: "external_issue" });
assert(procurementExternalIssue.externalOnly, "Provider-backed PO issue must remain external-only");
assert.equal(w10Progress("procurement", "PO_DRAFT"), 50, "Procurement progress must be derived from the governed state machine");
assert.equal(w10ExternalStatus("PO_DRAFT"), "SITES_READY", "PO draft must remain a Sites-local state");
assert.equal(w10ExternalStatus("PO_ISSUED"), "EXTERNAL_DEFERRED", "Provider-backed PO issue must remain visibly deferred");
assert.throws(() => transitionW10Workflow({ module: "finance", status: "PROPOSED", action: "reconcile" }), /w10_invalid_transition/, "Finance must not skip review and approval");

assert(ROLE_CAPABILITIES.owner.includes("tenant.manage"), "Owner must retain tenant management");
assert(ROLE_CAPABILITIES.owner.includes("authority.manage"), "Owner must retain authority management");
assert(!ROLE_CAPABILITIES.worker.includes("command.read"), "Worker must not see the executive Command dashboard");
assert(!ROLE_CAPABILITIES.auditor.includes("command.customize"), "Auditor must not persist dashboard changes");
assert(ROLE_CAPABILITIES.warehouse_operator.includes("warehouse.write"), "Warehouse operator must retain warehouse writes");
assert(!ROLE_CAPABILITIES.warehouse_operator.includes("warehouse.register"), "Warehouse operator must not create material master data");
assert(ROLE_CAPABILITIES.warehouse_manager.includes("warehouse.register"), "Warehouse manager must register material master data");
assert(!ROLE_CAPABILITIES.warehouse_operator.includes("finance.read"), "Warehouse operator must not inherit finance visibility");
assert(ROLE_CAPABILITIES.worker.includes("warehouse.request"), "Field workers must be able to request materials");
assert(!ROLE_CAPABILITIES.worker.includes("warehouse.write"), "Field workers must not mutate stock balances");
assert(ROLE_CAPABILITIES.worker.includes("attendance.self"), "Field workers must retain self attendance capability");
assert(ROLE_CAPABILITIES.manager.includes("attendance.approve"), "Managers must retain attendance approval capability");
assert(ROLE_CAPABILITIES.worker.includes("pwa.read") && ROLE_CAPABILITIES.driver.includes("pwa.read"), "Operational roles must retain PWA diagnostics visibility");
assert(ROLE_CAPABILITIES.delivery_driver.includes("mission.delivery.execute") && ROLE_CAPABILITIES.delivery_driver.includes("mission.report.write"), "Delivery drivers must execute delivery missions and write mission reports");
assert(!ROLE_CAPABILITIES.delivery_driver.includes("mission.manage"), "Delivery drivers must not manage mission planning");
const multiRoleFixture = normalizeAuthorityRoles('["driver","warehouse_manager","driver"]');
assert.deepEqual(multiRoleFixture, ["driver", "warehouse_manager"], "Multi-role memberships must normalize and deduplicate roles");
const multiRoleCapabilities = new Set(multiRoleFixture.flatMap((role) => ROLE_CAPABILITIES[role]));
assert(multiRoleCapabilities.has("mission.write") && multiRoleCapabilities.has("warehouse.register"), "Multi-role capabilities must be unioned server-side");

for (const profile of ["OPERATIONS", "WAREHOUSE", "TRANSPORT", "WAREHOUSE_TRANSPORT", "FULL_OPERATIONS"]) {
  assert(OPERATING_PROFILE_CATALOG[profile]?.domains?.length, `${profile} must declare at least one operating domain`);
  assert(Array.isArray(OPERATING_PROFILE_CATALOG[profile]?.transportModes), `${profile} must declare transport modes`);
}
assert(Object.keys(TRANSPORT_MODE_CATALOG).length === 5, "Transport mode catalog must preserve the five canonical flows");
assert(transportModesForProfile("OPERATIONS").length === 0, "Operations-only tenants must not receive internal transport modes by default");
assert(transportModesForProfile("TRANSPORT").includes("ASSET_TRANSFER"), "Transport-only tenants must support asset transfer");
assert(transportModesForProfile("WAREHOUSE").includes("WAREHOUSE_TO_RECIPIENT"), "Warehouse tenants must support warehouse-to-recipient requests");
assert(transportModesForProfile("FULL_OPERATIONS").includes("WAREHOUSE_TO_JOB"), "Full tenants must support warehouse-to-job transport");
const warehouseOnlyCapabilities = filterCapabilitiesForDomains(ROLE_CAPABILITIES.owner, ["warehouse"]);
assert(warehouseOnlyCapabilities.includes("warehouse.read"), "Warehouse-only tenants must retain warehouse visibility");
assert(!warehouseOnlyCapabilities.includes("mission.read"), "Warehouse-only tenants must not inherit mission visibility");
assert(!warehouseOnlyCapabilities.includes("asset.read"), "Warehouse-only tenants must not inherit transport asset visibility");
const transportCapabilities = filterCapabilitiesForDomains(ROLE_CAPABILITIES.owner, ["transport"]);
assert(transportCapabilities.includes("mission.read") && transportCapabilities.includes("workforce.read"), "Transport tenants must retain mission and workforce visibility");
assert(transportCapabilities.includes("planning.read"), "Transport tenants must retain planning visibility");
assert(!transportCapabilities.includes("warehouse.read"), "Transport-only tenants must not inherit warehouse visibility");
const operationsCapabilities = filterCapabilitiesForDomains(ROLE_CAPABILITIES.owner, ["operations"]);
assert(operationsCapabilities.includes("workforce.read") && operationsCapabilities.includes("planning.read"), "Operations tenants must retain workforce and planning visibility");

const workerNavigation = getAllowedCommandNavigation(ROLE_CAPABILITIES.worker).map((item) => item.id);
assert(!workerNavigation.includes("command"), "Worker navigation must hide Command");
assert(workerNavigation.includes("operations"), "Worker navigation must expose authorized operations");

const managerDefaults = defaultCommandWidgetLayout(ROLE_CAPABILITIES.manager);
const maliciousLayout = sanitizeCommandWidgetLayout([
  { id: "kpi-jobs", size: "full", visible: true },
  { id: "unknown-admin-widget", size: "full", visible: true },
  { id: "kpi-jobs", size: "compact", visible: false },
], ROLE_CAPABILITIES.manager);
assert.equal(maliciousLayout.filter((item) => item.id === "kpi-jobs").length, 1, "Duplicate widgets must collapse");
assert(!maliciousLayout.some((item) => item.id === "unknown-admin-widget"), "Unknown widgets must be rejected");
assert.equal(maliciousLayout.find((item) => item.id === "kpi-jobs")?.size, "compact", "Invalid size must fall back to the catalog default");
assert.equal(maliciousLayout.length, managerDefaults.length, "Missing authorized widgets must be restored from the server catalog");

const guardFiles = {
  operations: "operations.read",
  workforce: "workforce.read",
  planning: "planning.read",
  presenze: "workforce.read",
  assets: "asset.read",
  warehouse: "warehouse.read",
  mission: "mission.read",
  finance: "finance.read",
  procurement: "procurement.read",
  documents: "documents.read",
  governance: "governance.read",
  communications: "communication.read",
  events: "events.read",
  externals: "external_adapters.read",
  pwa: "pwa.read",
  release: "governance.read",
  onboarding: "authority.read",
  qr: "qr.read",
  settings: "settings.read",
};

for (const [route, capability] of Object.entries(guardFiles)) {
  const path = join(root, "app", route, "layout.tsx");
  await access(path);
  const source = await readFile(path, "utf8");
  if (route === "onboarding") {
    assert(source.includes("getAuthenticatedIdentity"), "onboarding must require an authenticated account");
    assert(source.includes('context.tenantStatus === "onboarding"'), "onboarding must allow the primary setup state");
    assert(source.includes(`hasCapability(context, "${capability}")`), `${route} Authority surface must require ${capability}`);
  } else {
    assert(source.includes(`requirePageCapability("${capability}")`), `${route} must require ${capability}`);
  }
}

const migration = await readFile(join(root, "drizzle", "0010_command_dashboard_preferences.sql"), "utf8");
assert(migration.includes("command_dashboard_preferences_tenant_actor_uq"), "Widget preferences need a tenant + actor unique index");

const rateLimitMigration = await readFile(join(root, "drizzle", "0011_ai_rate_limit_windows.sql"), "utf8");
assert(rateLimitMigration.includes("ai_rate_limit_windows_scope_uq"), "AI quota needs an atomic tenant + actor + action + window key");

const authorityMigration = await readFile(join(root, "drizzle", "0012_authority_membership_lifecycle.sql"), "utf8");
assert(authorityMigration.includes("tenant_invitations_token_uq"), "Authority invitations need one-time token uniqueness");
assert(authorityMigration.includes("version"), "Membership lifecycle must use optimistic versions");

const journeyMigration = await readFile(join(root, "drizzle", "0013_commercial_job_journey.sql"), "utf8");
for (const table of ["job_journey_records", "inventory_items", "inventory_movements", "operational_documents"]) {
  assert(journeyMigration.includes(`CREATE TABLE \`${table}\``), `Commercial journey migration must create ${table}`);
}
assert(journeyMigration.includes("inventory_items_tenant_sku_uq"), "Inventory SKUs must be tenant-unique");
assert(journeyMigration.includes("operational_documents_tenant_job_hash_uq"), "Documents must deduplicate by tenant, job and hash");

const w10Migration = await readFile(join(root, "drizzle", "0014_w10_workflows.sql"), "utf8");
assert(w10Migration.includes("CREATE TABLE `w10_workflows`"), "W10 must persist governed workflow records");
assert(w10Migration.includes("w10_workflows_tenant_idempotency_uq"), "W10 workflow creation must be idempotent per tenant");
assert(w10Migration.includes("w10_workflows_tenant_module_status_idx"), "W10 workflow status readback must be indexed");

const rateLimitAdapter = await readFile(join(root, "lib", "ai-rate-limit.ts"), "utf8");
assert(rateLimitAdapter.includes("requestCount} + 1"), "AI quota increments must be atomic");
assert(rateLimitAdapter.includes(".returning({ requestCount"), "AI quota enforcement must use the atomic returned count");
assert(rateLimitAdapter.includes("company_ai_rate_limit_exceeded"), "AI quota must expose a stable 429 contract");

const authorityContext = await readFile(join(root, "lib", "authority-context.ts"), "utf8");
assert(authorityContext.includes("canBootstrapSitesOwner"), "Sites owner bootstrap must be explicitly gated");
assert(authorityContext.includes("eq(tenants.id, SITES_TENANT_ID)"), "Sites owner bootstrap must close after canonical tenant provisioning");
assert(
  authorityContext.indexOf("const neonIdentity = await getNeonAuthIdentity()") < authorityContext.indexOf("const sitesUser = await getChatGPTUser()"),
  "Protected authority must resolve the authenticated Neon identity before the Sites fallback",
);

const pageAccess = await readFile(join(root, "lib", "page-access.ts"), "utf8");
assert(
  pageAccess.includes('identity.status === "error"') &&
    pageAccess.includes('context.identityProvider !== "neon"') &&
    pageAccess.includes('context.identityProvider !== "sites"'),
  "Page access must fail closed on configured Neon auth failures",
);
assert(pageAccess.includes('context.identityProvider !== "sites"'), "Sites page fallback must require a server-derived Sites identity");
for (const page of ["app/page.tsx", "app/command/page.tsx", "app/settings/page.tsx"]) {
  const source = await readFile(join(root, page), "utf8");
  assert(source.includes("requirePage"), `${page} must use the shared fail-closed page gate`);
  assert(!source.includes("getNeonAuthIdentity"), `${page} must not bypass the shared Sites/Neon page gate`);
}

const operationsLayout = await readFile(join(root, "app", "operations", "layout.tsx"), "utf8");
assert(operationsLayout.includes("AuthorityAccessProvider"), "Operations must receive server-derived capability context");
assert(operationsLayout.includes("role={authority.role}"), "Operations must expose the canonical role without hardcoding owner");

const operationsPage = await readFile(join(root, "app", "operations", "page.tsx"), "utf8");
assert(operationsPage.includes('authority.capabilities.has("operations.write")'), "Operations write controls must derive from operations.write");
assert(operationsPage.includes("visibleNavItems"), "Operations navigation must hide unauthorized modules");
assert(operationsPage.includes("canWriteOperations && newJobOpen"), "Read-only roles must not mount the new-job intake");

const jobWorkspace = await readFile(join(root, "components", "operations-job-workspace.tsx"), "utf8");
assert(jobWorkspace.includes("canWriteOperations"), "Job workspace mutation controls must be capability-aware");

const mobileNavigation = await readFile(join(root, "components", "command-mobile-nav.tsx"), "utf8");
assert(mobileNavigation.includes("canOpenCommand"), "Mobile navigation must hide Command-only destinations from field roles");

const preferencesRoute = await readFile(join(root, "app", "api", "command", "preferences", "route.ts"), "utf8");
assert(preferencesRoute.includes("context.tenantId"), "Preference writes must derive tenant from authority context");
assert(preferencesRoute.includes("context.actorId"), "Preference writes must derive actor from authority context");
assert(preferencesRoute.includes('hasCapability(context, "command.customize")'), "Preference writes must require command.customize");

const commandRoute = await readFile(join(root, "app", "api", "command", "ask", "route.ts"), "utf8");
assert(commandRoute.includes("askCompanyAiWithOpenAi"), "Command must call the governed OpenAI adapter");
assert(commandRoute.includes("directWrite: false"), "Command AI must retain the no-direct-write boundary");
assert(commandRoute.includes("consumeCompanyAiRateLimit"), "Command AI must enforce its server-side quota");
assert(commandRoute.includes("payload_too_large"), "Command AI must reject oversized payloads");
const commandDashboardRoute = await readFile(join(root, "app", "api", "command", "dashboard", "route.ts"), "utf8");
assert(commandDashboardRoute.includes("w10Workflows") && commandDashboardRoute.includes("finance.read") && commandDashboardRoute.includes("procurement.read"), "Command dashboard must expose W10 only when both read capabilities exist");
const commandSurface = await readFile(join(root, "components", "command-surface.tsx"), "utf8");
assert(commandSurface.includes("W10CommandPanel") && commandSurface.includes("finance-procurement"), "Command must render the capability-filtered W10 widget");
const commandReadinessRoute = await readFile(join(root, "app", "api", "command", "readiness", "route.ts"), "utf8");
assert(commandReadinessRoute.includes('hasCapability(context, "command.read")') && commandReadinessRoute.includes("getS07Ledger"), "Command readiness must be server-side and ledger-backed");
assert(commandReadinessRoute.includes('commercialStatus: "NO_GO"') && commandReadinessRoute.includes("openAiLive") && commandReadinessRoute.includes("getExternalSnapshot"), "Command readiness must keep live and commercial status explicit");
assert(commandSurface.includes("CommandReadinessPanel") && commandSurface.includes("command-readiness"), "Command must surface the W12 readiness widget");

const intakeRoute = await readFile(join(root, "app", "api", "operations", "intake", "route.ts"), "utf8");
assert(intakeRoute.includes("consumeCompanyAiRateLimit"), "Commessa intake must enforce its server-side quota");

const openAiAdapter = await readFile(join(root, "lib", "company-ai-openai.ts"), "utf8");
assert(openAiAdapter.includes("authorizedRecordIds"), "Model citations must be filtered against authorized records");
assert(openAiAdapter.includes("process.env[name]") && openAiAdapter.includes("cloudflare:workers"), "The OpenAI key must remain server-side");
assert(openAiAdapter.includes("getCompanyAiRuntimeStatus") && openAiAdapter.includes("companyAiLiveRequestFromCheck") && openAiAdapter.includes('"NOT_RUN"'), "OpenAI runtime metadata must not be confused with live evidence");
const aiReadinessRoute = await readFile(join(root, "app", "api", "governance", "ai-readiness", "route.ts"), "utf8");
assert(aiReadinessRoute.includes('hasCapability(context, "governance.read")'), "AI readiness must require governance.read");
assert(aiReadinessRoute.includes("getExternalSnapshot") && aiReadinessRoute.includes("getS07Ledger"), "AI readiness must combine provider evidence and Company AI ledger readback");
assert(aiReadinessRoute.includes('directWrite: false') && aiReadinessRoute.includes('commercialStatus: "NO_GO"'), "AI readiness must preserve no-direct-write and commercial gate semantics");
const aiGovernance = await readFile(join(root, "components", "company-ai-governance.tsx"), "utf8");
assert(aiGovernance.includes("/api/governance/ai-readiness") && aiGovernance.includes("COMMERCIAL NO-GO"), "Governance must expose the W12 readiness control plane");
assert(aiGovernance.includes("/governance/security"), "W12 governance must link to the W16 security control plane");
const securityContract = await readFile(join(root, "lib", "security-governance.ts"), "utf8");
assert(securityContract.includes("document-fail-closed") && securityContract.includes("PENDING_REVIEW") && securityContract.includes("PASS_LOCAL"), "W16 contract must keep fail-closed, human review and restore evidence explicit");
const securityReadinessRoute = await readFile(join(root, "app", "api", "governance", "security-readiness", "route.ts"), "utf8");
assert(securityReadinessRoute.includes('hasCapability(context, "governance.read")') && securityReadinessRoute.includes("buildSecurityControlCatalog"), "W16 readiness must be tenant-scoped and capability-gated");
assert(securityReadinessRoute.includes("MALWARE_SCAN_WEBHOOK_TOKEN") && securityReadinessRoute.includes('commercialStatus: "NO_GO"'), "W16 readiness must expose provider metadata without changing the commercial gate");
const securityPage = await readFile(join(root, "app", "governance", "security", "page.tsx"), "utf8");
const securitySurface = await readFile(join(root, "components", "security-privacy-control.tsx"), "utf8");
assert(securityPage.includes("SecurityPrivacyControl") && securitySurface.includes("/api/governance/security-readiness"), "W16 must have a readable security/privacy surface");
assert(securityPage.includes('requirePageCapability("governance.read")') && securityPage.includes("commandSurfaceAccess"), "W16 page must resolve authority server-side before rendering the control plane");
assert(securitySurface.includes("zw-command-ultra") && securitySurface.includes("CommandMobileNav") && securitySurface.includes("AccountMenu"), "W16 must share the Command shell and role-aware mobile navigation");
const releaseReadinessRoute = await readFile(join(root, "app", "api", "release", "readiness", "route.ts"), "utf8");
assert(releaseReadinessRoute.includes('hasCapability(context, "governance.read")') && releaseReadinessRoute.includes("buildReleaseGateCatalog"), "W17 release readiness must be tenant-scoped and capability-gated");
assert(releaseReadinessRoute.includes('promotionAllowed: summary.promotionAllowed') && releaseReadinessRoute.includes('tranche: "W17"'), "W17 release readiness must expose the promotion boundary");
const releaseContract = await readFile(join(root, "lib", "release-readiness.ts"), "utf8");
assert(releaseContract.includes("openai-live") && releaseContract.includes("commercial-signoff") && releaseContract.includes("restore-rehearsal"), "W17 release contract must aggregate provider, human and restore gates");
const releasePage = await readFile(join(root, "app", "release", "page.tsx"), "utf8");
const releaseSurface = await readFile(join(root, "components", "release-certification-center.tsx"), "utf8");
assert(releasePage.includes("ReleaseCertificationCenter") && releaseSurface.includes("/api/release/readiness") && releaseSurface.includes("COMMERCIAL NO-GO"), "W17 must have a readable release certification surface");
const releaseBuildRoute = await readFile(join(root, "app", "api", "release", "build", "route.ts"), "utf8");
assert(releaseBuildRoute.includes('tranche: "W17"') && releaseBuildRoute.includes('promotionAllowed: false') && releaseBuildRoute.includes('commercialStatus: "NO_GO"'), "Release identity must remain local and non-promotable");
const openAiLiveCheckRoute = await readFile(join(root, "app", "api", "governance", "ai-live-check", "route.ts"), "utf8");
assert(openAiLiveCheckRoute.includes('hasCapability(context, "tenant.manage")') && openAiLiveCheckRoute.includes("askCompanyAiWithOpenAi"), "OpenAI live check must be owner-capability-gated and use the server adapter");
assert(openAiLiveCheckRoute.includes('source: "sites-openai-live-check"') && openAiLiveCheckRoute.includes("outputPersisted: false"), "OpenAI live check must persist only redacted evidence and never model output");
const aiRateLimit = await readFile(join(root, "lib", "ai-rate-limit.ts"), "utf8");
assert(aiRateLimit.includes('"release-check"') && aiRateLimit.includes("fallback = action === \"intake\" ? 6 : action === \"release-check\" ? 2 : 12"), "OpenAI release checks must have a bounded dedicated rate limit");

const membershipRoute = await readFile(join(root, "app", "api", "authority", "memberships", "route.ts"), "utf8");
assert(membershipRoute.includes("createInvitationToken"), "Authority management must issue cryptographic invitations");
assert(membershipRoute.includes("last_active_owner"), "Authority management must protect the last active owner");
assert(membershipRoute.includes('target.actorId === context.actorId') && membershipRoute.includes('context.roles.includes("owner")') && membershipRoute.includes('requestedRoles.includes("owner")'), "Owner self-assignment must allow operational roles while preserving Owner authority");

const invitationRoute = await readFile(join(root, "app", "api", "authority", "invitations", "accept", "route.ts"), "utf8");
assert(invitationRoute.includes("hashInvitationToken"), "Invitation acceptance must compare token digests");
assert(invitationRoute.includes("normalizedIdentityEmail !== normalizeAuthorityEmail(invitation.email)"), "Invitation acceptance must bind the authenticated email");

const inventoryRoute = await readFile(join(root, "app", "api", "warehouse", "inventory", "route.ts"), "utf8");
assert(inventoryRoute.includes('hasCapability(context, "warehouse.write")'), "Stock mutation must require warehouse.write");
assert(inventoryRoute.includes("inventory_invariant_violation"), "Stock mutation must enforce balance invariants");
assert(inventoryRoute.includes("expected_version_required"), "Stock mutation must require optimistic versions");
assert(inventoryRoute.includes("mission_not_loadable"), "Material loading must reject missions outside the planned state");
assert(inventoryRoute.includes("findItemByIdentifier") && inventoryRoute.includes("inventory_identifier_not_found"), "Warehouse movement must resolve identifiers server-side");
assert(inventoryRoute.includes("storageShelf") && inventoryRoute.includes("qrCode"), "Warehouse material identity must persist shelf and server QR state");

const journeyRoute = await readFile(join(root, "app", "api", "operations", "jobs", "[jobId]", "journey", "route.ts"), "utf8");
assert(journeyRoute.includes("ACTION_CAPABILITY"), "Journey actions must be capability-gated");
assert(journeyRoute.includes("driverId") && journeyRoute.includes("vehicleId"), "Mission creation must use real driver and vehicle IDs");
assert(journeyRoute.includes("mission_free_text_resources_not_allowed"), "Mission creation must reject free-text resources");
assert(journeyRoute.includes("assertMissionResourceSelection"), "Mission creation must validate resource lifecycle and time-window availability");
assert(journeyRoute.includes("mission_resource_conflict"), "Mission creation must expose resource conflict readback");
assert(journeyRoute.includes("resolvePlanningResources") && journeyRoute.includes("input.resourceIds") && journeyRoute.includes("valid_planning_resources_required"), "Legacy journey planning must use canonical resource IDs");
assert(!journeyRoute.includes('responsible: boundedText(input.responsible'), "Journey planning must not persist free-text responsibility");
assert(journeyRoute.includes("planning_end_must_follow_start"), "Planning must validate temporal order");
assert(journeyRoute.includes("proof_of_delivery_recipient_required"), "Delivery must require POD identity");
assert(journeyRoute.includes("normalizeMissionPodEvidence") && journeyRoute.includes("pod_document_not_verified"), "Delivery must validate typed POD evidence and clean document state");
assert(journeyRoute.includes("mission_pod_evidence_required") && journeyRoute.includes("storedMissionPodEvidence"), "POD verification must block incomplete evidence with a server-side readback");
assert(journeyRoute.includes("mission_verify_pod"), "Mission journey must verify POD before reconciliation");
assert(journeyRoute.includes("mission_reconcile"), "Mission journey must reconcile before close");
assert(journeyRoute.includes("mission_close"), "Mission journey must expose a governed close state");
assert(journeyRoute.includes("mission_exception") && journeyRoute.includes("mission_resume"), "Mission journey must expose exception reporting and controlled recovery");
assert(journeyRoute.includes("mission_exception_manager_required") && journeyRoute.includes("mission_exception_already_open"), "Mission exceptions must preserve role and open-incident guards");
const locationDeliveryRoute = await readFile(join(root, "app", "api", "location", "deliveries", "route.ts"), "utf8");
assert(locationDeliveryRoute.includes("normalizeMissionPodEvidence") && locationDeliveryRoute.includes("pod_document_not_verified"), "Location delivery ledger must share the POD evidence and document security contract");
const missionControlRoute = await readFile(join(root, "app", "api", "mission", "control", "route.ts"), "utf8");
assert(missionControlRoute.includes('module: "mission"') && missionControlRoute.includes('source: "mission-standalone"') && missionControlRoute.includes("allocateServerName"), "Transport-only tenants must be able to create a server-named standalone mission");
assert(missionControlRoute.includes("mission_free_text_resources_not_allowed") && missionControlRoute.includes("assertMissionResourceSelection"), "Standalone mission creation must keep the same real-resource contract");
assert(missionControlRoute.includes("transport_mode_not_enabled") && missionControlRoute.includes("operatingTransportModes"), "Standalone transport must respect tenant-enabled transport modes");
assert(missionControlRoute.includes("trackingReadback") && missionControlRoute.includes("READ_MISSION_TRACKING") && missionControlRoute.includes("driver_check_in_required"), "Mission control must expose audited attendance-bound tracking readback");
assert(missionControlRoute.includes("currentStopId") && missionControlRoute.includes("lastLocationEvent") && missionControlRoute.includes("routeStateObservedAt"), "Mission tracking must expose the current stop and server-side geofence evidence");
const missionControl = await readFile(join(root, "components", "mission-control.tsx"), "utf8");
assert(missionControl.includes("TRANSPORT_MODE_CATALOG") && missionControl.includes('name="transportMode"') && missionControl.includes("operatingTransportModes"), "Standalone mission UI must expose only tenant-enabled transport modes");

const planningRoute = await readFile(join(root, "app", "api", "operations", "jobs", "[jobId]", "planning", "route.ts"), "utf8");
assert(planningRoute.includes('hasCapability(context, "planning.write")'), "Advanced planning mutations must require planning.write");
assert(planningRoute.includes("resolvePlanningResources") && planningRoute.includes("workforce_registry_access_required"), "Planning must resolve canonical resources and protect workforce registry scope");
assert(planningRoute.includes('action === "what_if"'), "Planning must expose an isolated what-if path");
assert(planningRoute.includes("planning_conflicts"), "Planning must reject unresolved capacity conflicts");
assert(planningRoute.includes("planning.plan.revised"), "Planning must preserve revision events");
const planningContract = await readFile(join(root, "lib", "planning-contract.ts"), "utf8");
assert(planningContract.includes("QUALIFICATION_MISSING"), "Planning must validate resource qualifications");
assert(planningContract.includes("CAPACITY_EXCEEDED"), "Planning must validate resource capacity");
const planningOptionsRoute = await readFile(join(root, "app", "api", "operations", "jobs", "[jobId]", "planning", "resource-options", "route.ts"), "utf8");
assert(planningOptionsRoute.includes('hasCapability(context, "planning.read")'), "Planning resource options must require planning.read");
assert(planningOptionsRoute.includes("unavailableAssets"), "Planning resource options must expose unavailable assets");
assert(planningOptionsRoute.includes("startsAt") && planningOptionsRoute.includes("endsAt") && planningOptionsRoute.includes("unavailableForWindow"), "Planning resource options must expose server-side window availability readback");
const planningResources = await readFile(join(root, "lib", "planning-resources.ts"), "utf8");
assert(planningResources.includes("activePlanningAssignments") && planningResources.includes("DRAFT") && planningResources.includes("PUBLISHED") && planningResources.includes("availableForWindow"), "Planning resource registry must evaluate active tenant assignments server-side");
const planningSurface = await readFile(join(root, "components", "planning-control.tsx"), "utf8");
assert(planningSurface.includes("/api/planning") && planningSurface.includes("PlanningResourceFields") && planningSurface.includes('action: \"draft\"'), "Planning module must provide a central readback and canonical resource draft flow");
assert(planningSurface.includes("openMissionFromPlan") && planningSurface.includes("Prepara missione") && planningSurface.includes("Apri missione") && planningSurface.includes("linkedMission"), "Published transport plans must expose a controlled handoff and linked mission readback");
const planningResourceFields = await readFile(join(root, "components", "planning-resource-fields.tsx"), "utf8");
assert(planningResourceFields.includes("startsAt") && planningResourceFields.includes("endsAt") && planningResourceFields.includes("disabled={!available}"), "Planning UI must consume server-side availability and disable occupied resources");
const planningIndexRoute = await readFile(join(root, "app", "api", "planning", "route.ts"), "utf8");
assert(planningIndexRoute.includes('hasCapability(context, "planning.read")') && planningIndexRoute.includes("tenantId") && planningIndexRoute.includes("linkedMissionByPlan") && planningIndexRoute.includes("missionExecutionStatus"), "Central planning readback must be capability-gated, tenant-scoped and expose mission execution state");
assert(planningIndexRoute.includes("jobModule") && planningIndexRoute.includes("routeProgressForMission") && planningIndexRoute.includes("missionScheduleReadback") && planningIndexRoute.includes("missionExceptionReadback") && planningIndexRoute.includes("exceptionsOpen") && planningSurface.includes("Esecuzione") && planningSurface.includes("executionStatus") && planningSurface.includes("completedStops") && planningSurface.includes("Finestra") && planningSurface.includes("missionExceptionLabel"), "Planning readback must identify the owning operational domain and render mission execution, route progress, schedule coherence and exceptions");

const commandMapRoute = await readFile(join(root, "app", "api", "command", "map", "route.ts"), "utf8");
const operationalMapSurface = await readFile(join(root, "components", "operational-map-board.tsx"), "utf8");
assert(commandMapRoute.includes("jobJourneyRecords") && commandMapRoute.includes('hasCapability(context, "mission.read")') && commandMapRoute.includes("storedMissionException") && commandMapRoute.includes("missionExceptions") && commandMapRoute.includes("missionExceptionCount"), "Control map readback must expose tenant-scoped mission exceptions from the governed mission ledger");
assert(operationalMapSurface.includes("MissionExceptionSignals") && operationalMapSurface.includes("MISSIONI / ECCEZIONI") && operationalMapSurface.includes("missionExceptionLabel"), "Control map must render mission exceptions below the map without exposing raw GPS data");

const teamsRoute = await readFile(join(root, "app", "api", "authority", "teams", "route.ts"), "utf8");
assert(teamsRoute.includes('hasCapability(context, "authority.manage")') && teamsRoute.includes("team_membership_not_active"), "Team creation must be capability-gated and limited to active tenant memberships");
assert(teamsRoute.includes("s04Records") && teamsRoute.includes("s06Outbox") && teamsRoute.includes("SITES_READBACK_VERIFIED"), "Team creation must persist a tenant resource and its append-only readback ledger");
const authorityPage = await readFile(join(root, "app", "onboarding", "page.tsx"), "utf8");
assert(authorityPage.includes("/api/authority/teams") && authorityPage.includes("Crea squadra"), "Authority must expose a real team creation and readback surface");

const attendanceRoute = await readFile(join(root, "app", "api", "operations", "jobs", "[jobId]", "attendance", "route.ts"), "utf8");
const attendancePolicy = await readFile(join(root, "lib", "location-intelligence", "attendance-policy.ts"), "utf8");
assert(attendanceRoute.includes('tracking: "ATTENDANCE_GATED_ON_DUTY_ONLY"') && attendanceRoute.includes("driverTracking"), "Attendance must declare attendance-gated on-duty tracking policy");
assert(attendanceRoute.includes("correction_approve"), "Attendance must support governed corrections");
assert(attendanceRoute.includes("idempotency_key_required"), "Attendance replay must require idempotency");
assert(attendanceRoute.includes("4_DECIMAL_PLACES"), "Attendance location must be precision-limited");
assert(attendanceRoute.includes("recordedAt: now") && attendanceRoute.includes("clientObservedAt"), "Attendance must keep the official timestamp server-owned");
assert(attendanceRoute.includes("evaluateAttendanceGeofence") && attendancePolicy.includes("NO_GEOFENCE") && attendancePolicy.includes("pointInPolygon"), "Attendance must evaluate circle/polygon geofences server-side without inventing coordinates");
assert(attendanceRoute.includes("trackingSessionId") && attendanceRoute.includes("AFTER_VALID_ATTENDANCE_CHECK_IN"), "Driver tracking must be opened by a valid attendance check-in");
assert(attendanceRoute.includes("attendance.self") && attendanceRoute.includes("attendance.approve"), "Attendance actions must expose dedicated capabilities with legacy aliases");
const attendanceControl = await readFile(join(root, "components", "attendance-control.tsx"), "utf8");
assert(attendanceControl.includes("navigator.geolocation") && attendanceControl.includes("/attendance") && attendanceControl.includes("check_in") && attendanceControl.includes("check_out") && attendanceControl.includes("consentire la posizione"), "Attendance UI must capture and require GPS for entry/exit");
const operationalAttendanceDeck = await readFile(join(root, "components", "operational-attendance-deck.tsx"), "utf8");
const operationsJobWorkspace = await readFile(join(root, "components", "operations-job-workspace.tsx"), "utf8");
const operationsJobRoute = await readFile(join(root, "app", "api", "operations", "jobs", "[jobId]", "route.ts"), "utf8");
const operationsJobPage = await readFile(join(root, "app", "operations", "[jobId]", "page.tsx"), "utf8");
assert(attendanceControl.includes("reportHref") && attendanceControl.includes("CHIUSURA TURNO COMPLETATA") && attendanceControl.includes("Crea rapportino con Company AI"), "Commessa attendance must hand off a closed shift to the Company AI report flow");
assert(operationalAttendanceDeck.includes('target.kind === "DRIVER" ? null') && operationalAttendanceDeck.includes("open=rapportino"), "Driver attendance must remain mission-owned while non-driver service attendance can open the Company AI report");
assert(operationsJobWorkspace.includes("useSearchParams") && operationsJobWorkspace.includes('searchParams.get("open") === "rapportino"') && operationsJobWorkspace.includes('id="rapportino"'), "Operations workspace must open the Company AI report from the attendance handoff");
assert(operationsJobRoute.includes('hasCapability(context, "field.write")') && operationsJobRoute.includes('save_rapportino') && operationsJobRoute.includes('submit_rapportino') && operationsJobRoute.includes("reportActions"), "Field supervisors may write only the governed rapportino actions through the Operations API");
assert(operationsJobPage.includes("canWriteReport") && operationsJobPage.includes("canReviewReport") && operationsJobPage.includes('hasCapability(authority, "field.write")'), "Operations workspace must expose the rapportino to field supervisors without granting full commessa write access");
assert(operationsJobRoute.includes("review_rapportino") && operationsJobRoute.includes('approvals.review') && operationsJobRoute.includes('attendance.approve') && operationsJobRoute.includes("rapportino_changes_requested"), "Rapportino review must be capability-gated, auditable and separate from commessa closure");
assert(operationsJobWorkspace.includes("canReviewReport") && operationsJobWorkspace.includes("reviewNote") && operationsJobWorkspace.includes("Richiedi integrazione") && operationsJobWorkspace.includes("Approva rapportino"), "Operations workspace must expose office review without merging it into the job status flow");
const trackingSessionRoute = await readFile(join(root, "app", "api", "location", "sessions", "route.ts"), "utf8");
assert(trackingSessionRoute.includes("valid_attendance_check_in_required") && trackingSessionRoute.includes("tracking_requires_driver_attendance"), "Direct tracking start must remain behind the attendance gate");
const trackingDeviceRoute = await readFile(join(root, "app", "api", "location", "devices", "route.ts"), "utf8");
assert(trackingDeviceRoute.includes("tracking_requires_valid_attendance_check_in") && trackingDeviceRoute.includes("if (!session)"), "Polling must not read GPS before an active attendance-bound session");
const locationIngest = await readFile(join(root, "lib", "location-intelligence", "ingest.ts"), "utf8");
assert(locationIngest.includes("__operationalContext") && locationIngest.includes("expectedStop"), "Location events must retain mission/expected-stop context without exposing raw coordinates to Company AI");
const attendanceOverview = await readFile(join(root, "components", "attendance-overview.tsx"), "utf8");
assert(attendanceOverview.includes("/api/workforce/attendance") && attendanceOverview.includes("Timestamp server"), "Attendance module must expose a central server-timestamped readback");
const attendanceOverviewRoute = await readFile(join(root, "app", "api", "workforce", "attendance", "route.ts"), "utf8");
assert(attendanceOverviewRoute.includes('hasCapability(context, "workforce.read")') && attendanceOverviewRoute.includes("ON_DUTY_ONLY") && attendanceOverviewRoute.includes("tenantId"), "Attendance overview must remain capability-gated, on-duty and tenant-scoped");

const assetLifecycleRoute = await readFile(join(root, "app", "api", "assets", "lifecycle", "route.ts"), "utf8");
assert(assetLifecycleRoute.includes('hasCapability(context, "asset.write")'), "Asset lifecycle mutations must require asset.write");
assert(assetLifecycleRoute.includes("invalid_asset_lifecycle_transition"), "Asset lifecycle must enforce state transitions");
assert(assetLifecycleRoute.includes("availabilityGuard"), "Unavailable assets must be guarded from assignment");
const tenantOperatingModel = await readFile(join(root, "lib", "tenant-operating-model.ts"), "utf8");
assert(tenantOperatingModel.includes("OPERATING_PROFILE_CATALOG") && tenantOperatingModel.includes("filterCapabilitiesForDomains"), "Tenant onboarding must declare profile-to-domain capability filtering");
const tenantProfileRoute = await readFile(join(root, "app", "api", "tenants", "profile", "route.ts"), "utf8");
assert(tenantProfileRoute.includes('hasCapability(context, "tenant.manage")') && tenantProfileRoute.includes("operatingProfile") && tenantProfileRoute.includes("transportModes"), "Tenant onboarding profile and transport modes must be capability-gated and persisted");
const tenantSchema = await readFile(join(root, "db", "schema.ts"), "utf8");
assert(tenantSchema.includes("operatingTransportModesJson"), "Tenant schema must persist transport mode configuration");
const missionResourceContract = await readFile(join(root, "lib", "mission-resources.ts"), "utf8");
assert(missionResourceContract.includes("activeAssignments") && missionResourceContract.includes("normalizedMissionWindow"), "Mission resource registry must evaluate tenant-scoped time-window conflicts");
const missionResourceRoute = await readFile(join(root, "app", "api", "mission", "resources", "route.ts"), "utf8");
assert(missionResourceRoute.includes("server_validated_ids_only") && missionResourceRoute.includes("tenant_scoped_lifecycle_and_time_window"), "Mission resource options must expose the server validation contract");
const missionResourceFields = await readFile(join(root, "components", "mission-resource-fields.tsx"), "utf8");
assert(missionResourceFields.includes("/api/mission/resources") && missionResourceFields.includes('name="driverId"') && missionResourceFields.includes('name="vehicleId"'), "Mission UI must select registered driver and vehicle IDs");
assert(!missionResourceFields.includes('name="driver"') && !missionResourceFields.includes('name="vehicle"'), "Mission UI must not reintroduce free-text driver or vehicle fields");
assert(missionResourceFields.includes("onCargoAssetsChange") && missionResourceFields.includes("Seleziona uno o più asset reali"), "Mission resource selector must support multiple assets with readable identity");
const planningJourney = await readFile(join(root, "components", "job-commercial-journey.tsx"), "utf8");
assert(planningJourney.includes("PlanningResourceFields") && planningJourney.includes("resourceIds: planningResourceIds") && planningJourney.includes("startsAt={planningStartsAt}") && planningJourney.includes("endsAt={planningEndsAt}"), "Planning UI must select canonical resource IDs and server-window availability");
assert(!planningJourney.includes('name="responsible"') && planningJourney.includes("Attività della giornata"), "Planning UI must not reintroduce a free-text responsible field");
assert(planningJourney.includes("transportMode") && planningJourney.includes("TRANSPORT_MODE_CATALOG"), "Journey transport UI must expose tenant-enabled transport modes");
const operationsPlanningPage = await readFile(join(root, "app", "operations", "page.tsx"), "utf8");
assert(operationsPlanningPage.includes("savePlanningDraft") && operationsPlanningPage.includes("PlanningResourceFields"), "Operations planning surface must persist a real draft with canonical resources");
assert(operationsPlanningPage.includes("startsAt={planningStartsAt}") && operationsPlanningPage.includes("endsAt={planningEndsAt}") && operationsPlanningPage.includes("unavailableForWindow"), "Operations planning surface must consume server-side window availability");
const commandHero = await readFile(join(root, "components", "command-hero.tsx"), "utf8");
assert(commandHero.includes("/ai-zerow-icon.png") && !commandHero.includes("zw-command-hero__z"), "Command animation must use the supplied official ZEROW icon");

const documentRoute = await readFile(join(root, "app", "api", "operations", "jobs", "[jobId]", "documents", "route.ts"), "utf8");
assert(documentRoute.includes("MAX_OPERATIONAL_DOCUMENT_BYTES"), "Document upload must enforce the 20 MB contract");
assert(documentRoute.includes("matchesOperationalDocumentSignature"), "Document upload must validate file signatures");
assert(documentRoute.includes('scanStatus: "NOT_RUN"'), "Document upload must not claim an unavailable malware scan");
const commessaIntakeRoute = await readFile(join(root, "app", "api", "operations", "intake", "route.ts"), "utf8");
const commessaIntakeSurface = await readFile(join(root, "components", "operations-commessa-intake.tsx"), "utf8");
assert(commessaIntakeRoute.includes("multipart/form-data") && commessaIntakeRoute.includes("extractCompanyAiSpreadsheetText"), "Commessa intake must accept server-parsed Excel files");
assert(commessaIntakeRoute.includes("MAX_OPERATIONAL_DOCUMENT_BYTES"), "Commessa intake Excel upload must enforce the 20 MB contract");
assert(commessaIntakeSurface.includes(".xls,.xlsx") && commessaIntakeSurface.includes("hasSourceFile"), "Commessa intake UI must expose XLS/XLSX Company AI analysis");
const documentSecurity = await readFile(join(root, "app", "api", "documents", "[documentId]", "security", "route.ts"), "utf8");
assert(documentSecurity.includes("malware_scan_provider_not_configured"), "Document security must remain explicit when no provider is configured");
assert(documentSecurity.includes("provider_result"), "Document security must expose provider result readback");
assert(documentSecurity.includes("provider_sha256_mismatch"), "Document provider callbacks must be bound to the stored file hash");
const documentSecurityContract = await readFile(join(root, "lib", "document-security.ts"), "utf8");
assert(documentSecurityContract.includes("document_release_requires_provider_clean"), "Documents must not be released without provider clean evidence");
const outboxContract = await readFile(join(root, "lib", "outbox-contract.ts"), "utf8");
assert(outboxContract.includes("DEAD_LETTERED"), "Outbox must have a dead-letter state");
assert(outboxContract.includes("OUTBOX_MAX_ATTEMPTS"), "Outbox retry budget must be bounded");
const outboxRoute = await readFile(join(root, "app", "api", "events", "outbox", "route.ts"), "utf8");
assert(outboxRoute.includes("transitionOutbox"), "Outbox route must use the governed state machine");
const cloudflareEnv = await readFile(join(root, "cloudflare-env.d.ts"), "utf8");
assert(cloudflareEnv.includes("OPENAI_API_KEY"), "OpenAI runtime secret must be declared as a Site binding");
const externalAdapters = await readFile(join(root, "lib", "external-adapter.ts"), "utf8");
assert(externalAdapters.includes('key: "openai-runtime"') && externalAdapters.includes('status: "NOT_RUN"'), "OpenAI external adapter must distinguish local binding from live certification");
const communicationsLayout = await readFile(join(root, "app", "communications", "layout.tsx"), "utf8");
assert(communicationsLayout.includes('requirePageCapability("communication.read")'), "Communications must be capability-gated");
const communicationsPage = await readFile(join(root, "app", "communications", "page.tsx"), "utf8");
const communicationsRoute = await readFile(join(root, "app", "api", "communications", "route.ts"), "utf8");
const communicationsSurface = await readFile(join(root, "components", "communications-control.tsx"), "utf8");
assert(communicationsPage.includes("CommunicationsControl") && communicationsSurface.includes("/api/communications"), "W13 must use the governed Communications control deck");
assert(communicationsRoute.includes('hasCapability(context, "communication.send")') && communicationsRoute.includes("job_not_found_in_tenant"), "W13 writes must be capability-gated and tenant-bound");
assert(communicationsRoute.includes("voice_requires_acknowledgement") && communicationsRoute.includes("EXTERNAL_DEFERRED"), "W13 voice must preserve consent and provider-deferred boundaries");
assert(communicationsSurface.includes("acknowledgement") && communicationsSurface.includes("VOICE_PROPOSAL") && communicationsSurface.includes("deliveryStatus"), "W13 must expose acknowledgement, voice proposal and delivery readback");
const integrationsPage = await readFile(join(root, "app", "externals", "page.tsx"), "utf8");
const integrationsSurface = await readFile(join(root, "components", "external-integrations-control.tsx"), "utf8");
const externalAdapterContract = await readFile(join(root, "lib", "external-adapter.ts"), "utf8");
assert(integrationsPage.includes("ExternalIntegrationsControl") && integrationsSurface.includes("/api/externals"), "W14 must use the Integrazioni control deck");
assert(integrationsSurface.includes("INTEGRATIONS CONTROL") && integrationsSurface.includes("APPEND-ONLY CHECK LOG") && integrationsSurface.includes("NO FAKE HEALTH"), "W14 must expose registry, evidence and no-fake-health boundaries");
assert(integrationsSurface.includes("tenant.manage") && integrationsSurface.includes("direct external write"), "W14 UI must expose the server-owned write boundary");
assert(externalAdapterContract.includes('operation === "write" ? "tenant.manage" : "external_adapters.read"'), "W14 adapter access must align read and write capabilities");
const pwaPage = await readFile(join(root, "app", "pwa", "diagnostics", "page.tsx"), "utf8");
const pwaSurface = await readFile(join(root, "components", "pwa-mobile-control.tsx"), "utf8");
const pwaManifest = await readFile(join(root, "public", "manifest.webmanifest"), "utf8");
const pwaServiceWorker = await readFile(join(root, "public", "sw.js"), "utf8");
assert(pwaPage.includes("PwaMobileControl") && pwaSurface.includes("indexedDB") && pwaSurface.includes("/api/events"), "W15 must expose the governed PWA surface, local queue and event replay");
assert(pwaSurface.includes("beforeinstallprompt") && pwaSurface.includes("NOT RUN") && pwaSurface.includes("navigator.serviceWorker"), "W15 must distinguish observed installability from unrun device certification");
assert(pwaManifest.includes('"display": "standalone"') && pwaManifest.includes('"start_url": "/command"'), "W15 PWA manifest must remain standalone and start at Command");
assert(pwaServiceWorker.includes("request.method !== \"GET\"") && pwaServiceWorker.includes("/offline"), "W15 service worker must keep API writes out of cache and provide offline fallback");
assert(journeyRoute.includes('document_security: hasCapability(context, "documents.write")'), "Document security controls must be capability-gated in the journey readback");
const eventsControl = await readFile(join(root, "components", "events-control-page.tsx"), "utf8");
assert(eventsControl.includes("/api/events/outbox"), "Events Authority must expose outbox controls");
const journeyControl = await readFile(join(root, "components", "job-commercial-journey.tsx"), "utf8");
assert(journeyControl.includes("mutateDocumentSecurity"), "Job journey must expose document security controls");
const w10Route = await readFile(join(root, "app", "api", "workflows", "[module]", "route.ts"), "utf8");
assert(w10Route.includes("expectedVersion"), "W10 transitions must enforce optimistic versions");
assert(w10Route.includes("approvals.review"), "W10 approval transitions must use the authority capability");
assert(w10Route.includes("external_executor_deferred"), "W10 must not simulate provider-backed execution");
assert(w10Route.includes("s06Outbox") && w10Route.includes("s06Reconciliations"), "W10 transitions must emit outbox and reconciliation readback");
const w10Control = await readFile(join(root, "components", "w10-workflow-control.tsx"), "utf8");
assert(w10Control.includes("/api/${module}/workflow"), "W10 UI must use the governed workflow endpoint");
assert(w10Control.includes("externalActions"), "W10 UI must visibly hold provider-backed actions");
for (const page of ["app/finance/page.tsx", "app/procurement/page.tsx"]) {
  const source = await readFile(join(root, page), "utf8");
  assert(source.includes("W10WorkflowControl"), `${page} must use the W10 governed surface`);
}

const hosting = JSON.parse(await readFile(join(root, ".openai", "hosting.json"), "utf8"));
assert.equal(hosting.r2, "BUCKET", "Commercial documents require the R2 binding");

const releaseManifest = JSON.parse(await readFile(join(root, "docs", "COMMERCIAL_V1_RC2_9_LOCAL_BUILD_MANIFEST.json"), "utf8"));
assert.equal(releaseManifest.buildId, RELEASE_BUILD_ID, "Runtime and RC2.9 manifest must share one build ID");
assert.equal(releaseManifest.promotion.allowed, false, "RC2.9 must remain blocked from deployment");
assert.equal(releaseManifest.rollback.d1RestoreRehearsal, "PASS_LOCAL", "RC2.9 must record the D1 restore rehearsal");
assert.equal(releaseManifest.rollback.r2RestoreRehearsal, "PASS_LOCAL", "RC2.9 must record the R2 restore rehearsal");
assert.equal(releaseManifest.releaseCenter.tranche, "W17", "RC2.9 manifest must bind the W17 release center");
assert.equal(releaseManifest.verification.runtimeHttpSmoke.local, "PASS_LOCAL_AUTH_PWA_AND_NO_GO_BOUNDARY", "RC2.9 must record the local runtime smoke evidence");
assert.equal(releaseManifest.verification.runtimeHttpSmoke.publishedEdge, "PASS_OWNER_ONLY_EDGE", "RC2.9 must record the published owner-only edge evidence");
assert.equal(releaseManifest.verification.surfaceAudit, "PASS_WITH_EXTERNAL_GATES", "RC2.9 must record the full local surface audit");
assert.equal(releaseManifest.verification.mapAndGps, "SCHEMATIC_ONLY_PROVIDER_AND_BROWSER_GPS_NOT_CONNECTED", "RC2.9 must not claim a live map or GPS provider");
const serviceWorker = await readFile(join(root, "public", "sw.js"), "utf8");
assert(serviceWorker.includes(RELEASE_BUILD_ID), "The service worker cache must use the current RC build ID");

console.log(JSON.stringify({
  status: "PASS",
  roles: AUTHORITY_ROLES.length,
  widgets: COMMAND_WIDGET_CATALOG.length,
  guardedRoutes: Object.keys(guardFiles).length,
  migrations: 5,
  aiGuards: ["payload_limit", "rate_limit", "citation_allowlist", "no_direct_write"],
  commercialJourney: ["planning", "field", "inventory", "mission", "documents", "communications", "procurement", "finance"],
  localHardening: ["openai_site_binding", "company_ai_readiness_control_plane", "security_privacy_dr_readiness", "release_certification_center", "ui_alignment_audit", "runtime_http_smoke", "full_surface_audit", "e2e_readback_roles_tenant", "outbox_retry_dlq", "document_security_hold", "mission_pod_reconciliation", "mission_exception_recovery", "mission_live_tracking_readback", "w10_workflow_approval_reconcile"],
  checks: "commercial-v1-static-contract",
}));
