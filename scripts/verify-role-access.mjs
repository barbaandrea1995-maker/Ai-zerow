import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { AUTHORITY_ROLES, ROLE_CAPABILITIES } from "../lib/authority-catalog.ts";
import { canWriteOperationsRapportino } from "../lib/operations-permissions.ts";
import { COMMAND_NAVIGATION, COMMAND_WIDGET_CATALOG } from "../lib/command-dashboard.ts";
import { filterCapabilitiesForDomains } from "../lib/tenant-operating-model.ts";
import { mobileNavigationForAuthority } from "../lib/mobile-navigation.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const indexRoles = new Set([
  "owner", "admin", "member", "manager", "office", "technical", "field_supervisor", "auditor",
]);
const reportWriterRoles = new Set([
  "owner", "admin", "manager", "office", "technical", "field_supervisor",
]);

for (const role of AUTHORITY_ROLES) {
  const capabilities = ROLE_CAPABILITIES[role];
  assert.equal(
    capabilities.includes("operations.index.read"),
    indexRoles.has(role),
    `${role}: commesse-index access must match its explicit role contract`,
  );
  assert.equal(
    canWriteOperationsRapportino(capabilities),
    reportWriterRoles.has(role),
    `${role}: Company AI rapportino access must match its explicit role contract`,
  );
}

assert(ROLE_CAPABILITIES.worker.includes("operations.read"), "Operatore must retain only the scoped commessa context used by Presenze");
assert(!ROLE_CAPABILITIES.worker.includes("operations.index.read"), "Operatore must not have index access");
assert(!ROLE_CAPABILITIES.worker.includes("workforce.registry.read"), "Operatore must not gain the supervisor report permission");
assert.equal(
  canWriteOperationsRapportino(ROLE_CAPABILITIES.worker),
  false,
  "Operatore cannot receive the Company AI report handoff",
);
assert(!ROLE_CAPABILITIES.maintenance.includes("asset.write"), "Manutentore cannot create or reclassify asset records");
assert(ROLE_CAPABILITIES.maintenance.includes("asset.lifecycle.write"), "Manutentore retains lifecycle actions for assigned assets");

const navigation = COMMAND_NAVIGATION.find((item) => item.id === "operations");
assert.equal(navigation?.requiredCapability, "operations.index.read", "Every shared module sidebar must use the index capability");
const jobsWidget = COMMAND_WIDGET_CATALOG.find((widget) => widget.id === "jobs");
assert(jobsWidget?.requiredCapabilities.includes("operations.index.read"), "The full jobs widget must require commesse index access");
const workerMobile = mobileNavigationForAuthority({
  role: "worker",
  roles: ["worker"],
  capabilities: ROLE_CAPABILITIES.worker,
});
assert.equal(workerMobile?.profile, "field", "Operatore must use the focused field profile");
assert(!workerMobile?.items.some((item) => item.id === "operations"), "Operatore bottom navigation must not expose Commesse");

const mixedRoles = [...ROLE_CAPABILITIES.worker, ...ROLE_CAPABILITIES.field_supervisor];
assert(mixedRoles.includes("operations.index.read"), "Capabilities from multiple assigned roles remain additive");
assert(canWriteOperationsRapportino(mixedRoles), "A mixed membership receives the report capability only through its explicit supervisor role");

const operationsOnly = filterCapabilitiesForDomains(ROLE_CAPABILITIES.owner, ["operations"]);
const transportOnly = filterCapabilitiesForDomains(ROLE_CAPABILITIES.owner, ["transport"]);
assert(operationsOnly.includes("operations.index.read"), "Operations tenants retain the commesse index");
assert(!transportOnly.includes("operations.index.read"), "Transport-only tenants do not expose the commesse index");

const [indexPage, jobPage, attendance, home, attendanceApi, operationsApi, reportApi] = await Promise.all([
  readFile(join(root, "app/operations/page.tsx"), "utf8"),
  readFile(join(root, "app/operations/[jobId]/page.tsx"), "utf8"),
  readFile(join(root, "components/attendance-overview.tsx"), "utf8"),
  readFile(join(root, "components/operational-home.tsx"), "utf8"),
  readFile(join(root, "app/api/operations/jobs/[jobId]/attendance/route.ts"), "utf8"),
  readFile(join(root, "app/api/operations/route.ts"), "utf8"),
  readFile(join(root, "app/api/operations/jobs/[jobId]/route.ts"), "utf8"),
]);
const navigationSurfaces = await Promise.all([
  "components/mission-command-deck.tsx",
  "components/events-control-page.tsx",
  "app/onboarding/page.tsx",
  "components/asset-control.tsx",
  "components/documents-control-deck.tsx",
  "components/w10-workflow-control.tsx",
  "components/warehouse-control.tsx",
  "components/external-integrations-control.tsx",
  "components/communications-control.tsx",
].map((path) => readFile(join(root, path), "utf8")));
const [qrPage, qrControl, jobWorkspace] = await Promise.all([
  readFile(join(root, "app/qr/page.tsx"), "utf8"),
  readFile(join(root, "components/qr-barcode-control.tsx"), "utf8"),
  readFile(join(root, "components/operations-job-workspace.tsx"), "utf8"),
]);
const [assetSurface, assetLifecycleApi, documentSurface, warehouseSurface, warehouseRequests, missionSurfaceCode, membershipInvite] = await Promise.all([
  readFile(join(root, "components/asset-control.tsx"), "utf8"),
  readFile(join(root, "app/api/assets/lifecycle/route.ts"), "utf8"),
  readFile(join(root, "components/documents-control-deck.tsx"), "utf8"),
  readFile(join(root, "components/warehouse-control.tsx"), "utf8"),
  readFile(join(root, "components/warehouse-request-queue.tsx"), "utf8"),
  readFile(join(root, "components/mission-command-deck.tsx"), "utf8"),
  readFile(join(root, "components/authority-membership-control.tsx"), "utf8"),
]);

assert(indexPage.includes('requirePageCapability("operations.index.read")'), "The commesse index must have its own server-side page gate");
assert(jobPage.includes('requirePageCapability("operations.index.read")'), "The full commessa dossier must require index access");
assert(attendance.includes('capability: "operations.index.read"'), "Presenze sidebar must hide Commesse from roles without index access");
assert(attendance.includes("canReadOperationsIndex &&") && attendance.includes("canOpenAssignedJob ? <Link"), "Presenze must gate its index and assigned-job links by server capabilities");
assert(attendance.includes('if (jobModule === "warehouse") return "Magazzino / turno";'), "Presenze must label warehouse attendance as a warehouse shift");
assert(attendance.includes('navigate("/warehouse")') && attendance.includes('capabilities.includes("warehouse.read") ? <Button'), "Presenze must open the authorized warehouse module for warehouse attendance");
assert(attendance.includes('capabilities.includes("planning.read") && <button') && attendance.includes('capabilities.includes("workforce.read") && <button'), "Presenze footer links must be hidden without their destination capability");
assert(attendance.includes('attendanceContextLabel(record.jobModule).toLocaleUpperCase("it-IT")'), "Presenze record rows must render the context label from the server module");
assert(attendance.includes("onClick={openCompanyAi}") && attendance.includes('navigate("/ai")'), "Field roles must use their authorized Company AI surface, not the denied Command route");
assert(home.includes('primaryHref: "/presenze"') && home.includes("rapportino Company AI è riservato al responsabile abilitato"), "Operatore Home must lead to Presenze and explain the report boundary");
assert(attendanceApi.includes("canWriteOperationsRapportino(context.capabilities)"), "Attendance handoff must use the canonical report permission");
assert(reportApi.includes("canWriteOperationsRapportino(context.capabilities)"), "Rapportino reads/writes must use the same permission contract");
assert(operationsApi.includes('hasCapability(context, "operations.read")') && operationsApi.includes("canReadAllOperations(context)"), "Operations readback must remain tenant-scoped for assigned-job consumers");
assert(jobPage.includes("full commesse surface") && operationsApi.includes("rowMatchesContext"), "Scoped field API context remains separate from the full dossier page");
assert(navigationSurfaces.every((surface) => !/capability:\s*"operations\.read"/.test(surface)), "No module sidebar may expose the commesse index using scoped operations.read");
const missionSurface = navigationSurfaces[0];
assert(missionSurface.includes('capabilities.includes("operations.index.read")'), "Mission links to a commessa must require index access");
assert(missionSurface.includes('capabilities.includes("planning.read")') && missionSurface.includes('capabilities.includes("documents.read")') && missionSurface.includes('capabilities.includes("warehouse.read")'), "Mission cross-module links must match each module capability");
assert(qrPage.includes("getAllowedCommandNavigation(authority.capabilities)"), "QR navigation must be derived from server authority");
assert(qrControl.includes("allowedNavigation.includes(item.id as CommandNavigationId)"), "QR sidebar must filter destinations by authorized navigation");
assert(jobWorkspace.includes('capabilities.has("operations.index.read")') && jobWorkspace.includes('canOpenOperationsIndex ? "/operations" : "/"'), "An assigned commessa workspace must not send an operator back to the full index");
assert(!jobWorkspace.includes('router.push("/command")'), "Field job workspace must return to the role-aware home, not Command");
assert(attendance.includes('const canOpenAssignedJob = canReadOperationsIndex || canWriteOperationsRapportino(capabilities)'), "Attendance must not create an operations entry point for a basic operator");
assert(!ROLE_CAPABILITIES.worker.includes("operations.index.read"), "The basic operator must not be able to open any commesse page");
assert(membershipInvite.includes('useState<AuthorityRole[]>(["worker"])'), "A new invitation must default to the least-privileged operational role");
assert(documentSurface.includes('capabilities.includes("operations.index.read") && <Link') && documentSurface.includes('selected.job && capabilities.includes("operations.index.read")'), "Document links to the commesse index and dossier must require index access");
assert(warehouseSurface.includes('capabilities.includes("operations.index.read") && <Link') && warehouseSurface.includes('capabilities.includes("mission.read") && <Link') && warehouseSurface.includes('capabilities.includes("qr.read") && <Link'), "Warehouse cross-module links must follow each destination capability");
assert(warehouseRequests.includes('setCanScheduleMission((result.context?.capabilities ?? []).includes("mission.manage"))') && warehouseRequests.includes('canScheduleMission ? <Link'), "A material request may expose mission scheduling only to dispatch roles");
assert(missionSurfaceCode.includes('if (!canManageMission)') && missionSurfaceCode.includes('capabilities.includes("operations.index.read")'), "Mission create handoffs and job links must fail closed by capability");
assert(assetSurface.includes('const canLifecycleWrite = canWrite || capabilities.includes("asset.lifecycle.write")') && assetSurface.includes('{canLifecycleWrite && <><Input'), "Asset lifecycle actions must use their narrower permission");
assert(assetSurface.includes('capabilities.includes("planning.read") && <Button') && assetSurface.includes('capabilities.includes("authority.read") && <Link') && assetSurface.includes('canOpenMission && <Link'), "Asset links must not send users to unauthorized modules");
assert(assetLifecycleApi.includes('hasCapability(context, "asset.write")') && assetLifecycleApi.includes('hasCapability(context, "asset.lifecycle.write")') && assetLifecycleApi.includes('at: now'), "Asset lifecycle writes must be scoped and timestamped by the server");

console.log(JSON.stringify({
  status: "PASS",
  roles: AUTHORITY_ROLES.length,
  commesseIndexRoles: [...indexRoles],
  reportWriterRoles: [...reportWriterRoles],
  operator: "Presenze-only entry; no commesse index or rapportino handoff",
  checks: ["role matrix", "mobile navigation", "multi-role union", "tenant operating profile", "server page gates", "attendance links", "cross-module navigation", "role-aware home returns", "rapportino capability consistency", "asset lifecycle scope", "creation and dispatch capability gates"],
}, null, 2));
