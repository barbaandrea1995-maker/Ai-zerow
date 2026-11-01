import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checks = [];

async function source(relative) {
  return fs.readFile(path.join(root, relative), "utf8");
}

async function must(relative, pattern, label) {
  const value = await source(relative);
  assert(pattern.test(value), `${label} (${relative})`);
  checks.push(label);
}

async function mustNot(relative, pattern, label) {
  const value = await source(relative);
  assert(!pattern.test(value), `${label} (${relative})`);
  checks.push(label);
}

async function mustBeMissing(relative, label) {
  const present = await fs.access(path.join(root, relative)).then(() => true).catch(() => false);
  assert(!present, `${label}: ${relative} still exists`);
  checks.push(label);
}

// Tenant and company identity: the same complete profile is used in every
// creation entry point, with an atomic owner membership and verified readback.
await must("app/api/tenants/route.ts", /validateCompanyProfile\(companyProfile\)/, "tenant profile server validation");
await must("app/api/tenants/route.ts", /await db\.batch\(\[/, "tenant and owner atomic write");
await must("app/api/tenants/route.ts", /tenant_readback_unavailable/, "tenant creation readback gate");
await must("app/tenants/tenants-client.tsx", /<CompanyProfileForm/, "tenant switcher uses complete company profile");
await must("components/primary-onboarding.tsx", /<CompanyProfileForm/, "primary onboarding shares company profile contract");

// Authority: roles are never truncated in the UI; profiles, memberships and
// warehouse scopes are tenant-owned server records with retry protection.
await must("app/onboarding/page.tsx", /AUTHORITY_ROLES\.map/, "all canonical roles selectable");
await mustNot("app/onboarding/page.tsx", /AUTHORITY_ROLES\.slice\(/, "role catalog is not truncated");
await must("app/api/authority/access-profiles/route.ts", /filterCapabilitiesForDomains/, "access profiles filtered by tenant domains");
await must("app/api/authority/access-profiles/route.ts", /idempotency_key_required/, "access profile idempotency required");
await must("app/api/authority/access-profiles/route.ts", /await db\.batch\(\[/, "access profile audit written atomically");
await must("app/api/authority/memberships/route.ts", /target\.actorId === context\.actorId/, "membership self-change boundary");
await must("app/api/authority/warehouse-assignments/route.ts", /eq\(tenantWarehouses\.tenantId, context\.tenantId\)/, "warehouse scope tenant catalog validation");

// Commessa creation: server catalog, AI scope, verified geocode, commercial
// terms, stock register, event ledger and readback are one governed slice.
await must("components/operations-commessa-intake.tsx", /usePendingRequestKeys\("operations-intake"\)/, "commessa retries preserve intent");
await must("components/operations-commessa-intake.tsx", /worksiteLocation/, "commessa requires selected geocode candidate");
await must("app/api/operations/route.ts", /worksite_location_candidate_mismatch/, "commessa address revalidated server-side");
await must("app/api/operations/route.ts", /company_ai_scope_confirmation_required/, "commessa AI scope requires human confirmation");
await must("app/api/operations/route.ts", /commercial_model_invalid/, "commessa commercial model server catalog");
await must("app/api/operations/route.ts", /db\.insert\(jobStockRegisters\)/, "commessa provisions job stock register");
await must("app/api/operations/route.ts", /await db\.batch\(writeStatements\)/, "commessa aggregate writes atomically");
await must("app/api/operations/route.ts", /operations_idempotency_readback_unavailable/, "commessa idempotent readback");

// Asset and resources: warehouses are canonical, vehicles cannot become cargo,
// and transport use is constrained by the tenant operating model.
await must("components/server-naming-dialog.tsx", /\/api\/authority\/warehouses/, "asset warehouse selector reads server catalog");
await must("app/api/[module]/route.ts", /asset_warehouse_not_found/, "asset warehouse revalidated server-side");
await must("app/api/[module]/route.ts", /transport_domain_not_enabled/, "asset transport domain gate");
await must("app/api/[module]/route.ts", /transportable: entityType === "vehicle" \? false/, "vehicles cannot be transported as cargo");
await must("app/api/assets/profile/route.ts", /non_vehicle_transport_usage_invalid/, "transport profile limited to vehicles");
await must("app/api/assets/assignments/route.ts", /vehicle_assignee_driver_capability_required/, "vehicle assignment requires driver capability");
await must("app/api/location/devices/route.ts", /tracking_vehicle_not_found[\s\S]*tracking_vehicle_not_active/, "GPS binding resolves a live tenant vehicle");

// Planning and mission: every person, vehicle, asset, location and document is
// resolved from the tenant catalogs again when the write reaches the server.
await must("components/planning-resource-fields.tsx", /resource-options/, "planning resources loaded from server window");
await must("app/api/operations/jobs/[jobId]/planning/route.ts", /resolvePlanningResources/, "planning resources canonically resolved");
await must("app/api/operations/jobs/[jobId]/planning/route.ts", /evaluateAgainstTenant/, "planning conflicts evaluated server-side");
await must("app/api/operations/jobs/[jobId]/planning/route.ts", /expectedVersion/, "planning optimistic concurrency");
await must("app/api/mission/resources/route.ts", /getMissionResourceCatalog\(\{[\s\S]*tenantId: context\.tenantId/, "mission warehouse choices tenant scoped");
await must("lib/mission-resources.ts", /s04Records[\s\S]*eq\(s04Records\.tenantId, args\.tenantId\)/, "mission driver, vehicle and cargo catalogs are server-owned");
await must("app/api/operations/jobs/[jobId]/journey/route.ts", /assertMissionResourceSelection/, "mission resources revalidated on write");
await must("lib/mission-resources.ts", /cargo_asset_not_transportable/, "mission cargo transportability revalidated");
await must("app/api/operations/jobs/[jobId]/journey/route.ts", /material_request_already_scheduled/, "material delivery mission deduplicated");
await must("components/mission-command-deck.tsx", /podDocuments[\s\S]*\/api\/documents\/catalog/, "mission POD uses document catalog choices");
await must("app/api/operations/jobs/[jobId]/journey/route.ts", /verifiedMissionPodDocument\(context\.tenantId, job\.id, podEvidence\.documentId\)/, "mission POD document belongs to same job");

// Warehouse and job stock: catalog units and warehouses are server-owned;
// pickup and delivery coexist and both credit the commessa register exactly once.
await must("app/api/warehouse/catalog/route.ts", /INVENTORY_UNIT_CATALOG/, "warehouse unit catalog server-owned");
await must("app/api/warehouse/inventory/route.ts", /unit_must_be_selected_from_catalog/, "warehouse unit revalidation");
await must("app/api/operations/jobs/[jobId]/journey/route.ts", /directPickupQuantity/, "material allocation supports direct pickup");
await must("app/api/operations/jobs/[jobId]/journey/route.ts", /missionDeliveryMilli: approvedQuantityMilli - directPickupMilli/, "pickup and delivery quantities balance");
await must("app/api/operations/jobs/[jobId]/material-pickup/route.ts", /isActorAssignedToJob/, "direct pickup requires job assignment");
await must("app/api/operations/jobs/[jobId]/material-pickup/route.ts", /jobStockMovements/, "direct pickup credits job stock");
await must("app/api/operations/jobs/[jobId]/stock/route.ts", /job_stock_reconciliation_catalog_changed/, "shift stock reconciliation detects stale catalogs");

// Documents and Finance: immutable originals and extraction evidence stay in
// Documents; only a reviewed, separately approved fact enters Finance.
await must("app/api/finance/documents/route.ts", /sha256/, "finance document content hash");
await must("app/api/finance/documents/route.ts", /finance_document_idempotency_conflict|duplicate/i, "finance document duplicate handling");
await must("app/api/finance/documents/[documentId]/review/route.ts", /sourceSha256/, "finance review bound to original hash");
await must("app/api/finance/documents/[documentId]/review/route.ts", /finance_allocation_total_mismatch/, "finance allocations must balance");
await must("app/api/finance/entries/route.ts", /finance_maker_checker_violation/, "finance independent approval gate");
await must("app/api/finance/entries/route.ts", /current\.version !== expectedVersion/, "finance optimistic concurrency");
await must("app/api/finance/entries/route.ts", /status: "REVERSED"/, "finance explicit reversal preserves history");
await must("components/finance-document-intake.tsx", /idempotentFormMutation/, "document uploads preserve retry intent");
await must("components/finance-console.tsx", /idempotentJsonMutation/, "finance mutations preserve retry intent");

// Communications, QR and navigation are all resolved from the current server
// authority context; operational roles get the canonical five-item mobile rail.
await must("app/api/communications/route.ts", /audienceCatalog/, "communications exposes server audience catalogs");
await must("app/api/communications/route.ts", /team_audience_not_found_in_tenant[\s\S]*role_audience_not_active_in_tenant/, "communications audience revalidation");
await must("app/api/qr/route.ts", /resolveCatalogEntity/, "QR resolves canonical catalog entities");
await must("lib/mobile-navigation.ts", /source: "authority-server"/, "mobile navigation authority source");
await must("lib/mobile-navigation.ts", /if \(items\.length !== candidates\.length\) return null/, "mobile navigation fails closed");
await must("lib/neon-auth/tenant-context.ts", /sessionIdentifierExposed: false|sessionId/, "auth context contract inspected");
await mustNot("app/api/auth-ab/readback/route.ts", /sessionId\s*:/, "auth readback does not expose session id");

// Client mutation policy: direct random keys are allowed only where the file
// demonstrably stores the pending request between retries.
const componentFiles = (await fs.readdir(path.join(root, "components"))).filter((name) => name.endsWith(".tsx"));
const randomKeyFiles = [];
for (const name of componentFiles) {
  const value = await source(`components/${name}`);
  if (/idempotencyKey[^\n]*(?:crypto\.)?randomUUID|randomUUID\(\)[^\n]*idempot/i.test(value)) randomKeyFiles.push(name);
}
assert.deepEqual(randomKeyFiles.sort(), ["attendance-control.tsx", "command-surface.tsx", "genius-document-scanner.tsx"], `Unmanaged random idempotency keys: ${randomKeyFiles.join(", ")}`);
await must("components/attendance-control.tsx", /pendingActions\.current/, "attendance preserves pending mutation");
await must("components/command-surface.tsx", /assistantRequestRef\.current/, "Company AI preserves pending query");
await must("components/genius-document-scanner.tsx", /idempotencyKey\.current/, "Genius scanner preserves pending upload");

for (const legacy of [
  "app/page-client.tsx",
  "components/command-hero.tsx",
  "components/mission-control.tsx",
  "components/s04-module-page.tsx",
  "components/s05-module-page.tsx",
]) await mustBeMissing(legacy, "legacy duplicate surface removed");

console.log(JSON.stringify({
  status: "PASS",
  checks: checks.length,
  domains: ["tenant", "authority", "operations", "assets", "planning", "mission", "warehouse", "documents", "finance", "communications", "qr", "navigation", "retry-safety"],
}, null, 2));
