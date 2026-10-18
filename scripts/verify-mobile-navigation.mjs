import assert from "node:assert/strict";
import { ROLE_CAPABILITIES } from "../lib/authority-catalog.ts";
import { mobileNavigationForAuthority } from "../lib/mobile-navigation.ts";

const expectedLabels = {
  control: ["Home", "Mappa", "AI", "Commesse", "Altro"],
  field: ["Home", "Comunicazioni", "AI", "Presenze", "Impostazioni"],
  driver: ["Home", "Comunicazioni", "AI", "Presenze", "Impostazioni"],
  warehouse: ["Home", "Comunicazioni", "AI", "Magazzino", "Impostazioni"],
  maintenance: ["Home", "Comunicazioni", "AI", "Asset", "Impostazioni"],
};

const expectedProfileByRole = {
  owner: "control",
  admin: "control",
  member: "control",
  manager: "control",
  office: "control",
  technical: "control",
  field_supervisor: "control",
  worker: "field",
  warehouse_manager: "warehouse",
  warehouse_operator: "warehouse",
  driver: "driver",
  delivery_driver: "driver",
  maintenance: "maintenance",
  auditor: "control",
};

const capabilityByHref = {
  "/communications": "communication.read",
  "/ai": "company_ai.read",
  "/operations": "operations.read",
  "/presenze": "workforce.read",
  "/warehouse": "warehouse.read",
  "/assets": "asset.read",
  "/settings": "settings.read",
};

const results = [];
for (const [role, capabilities] of Object.entries(ROLE_CAPABILITIES)) {
  const contract = mobileNavigationForAuthority({ role, roles: [role], capabilities });
  assert(contract, `${role} must resolve a navigation contract`);
  const expectedProfile = expectedProfileByRole[role];
  assert.equal(contract.profile, expectedProfile, `${role} must use ${expectedProfile}`);
  assert.equal(contract.source, "authority-server", `${role} contract must be server-derived`);
  assert.equal(contract.items.length, 5, `${role} must receive exactly five destinations`);
  assert.deepEqual(contract.items.map((item) => item.label), expectedLabels[expectedProfile], `${role} labels must be canonical`);
  assert.equal(contract.items.filter((item) => item.primary).length, 1, `${role} must have one primary AI destination`);

  for (const item of contract.items) {
    if (item.action) {
      assert.equal(item.id, "more", `${role} may expose an action only for the module menu`);
      assert.equal(item.action, "open-module-menu", `${role} module-menu action must be canonical`);
      assert.equal(item.href, undefined, `${role} module menu must not fake a page destination`);
      continue;
    }
    assert.equal(typeof item.href, "string", `${role} navigation destinations must have an href`);
    const capability = capabilityByHref[item.href];
    if (capability) assert(capabilities.includes(capability), `${role} may not receive ${item.href} without ${capability}`);
    if (item.href.startsWith("/command")) assert(capabilities.includes("command.read"), `${role} may not receive COMMAND anchors without command.read`);
  }

  results.push({ role, profile: contract.profile, labels: contract.items.map((item) => item.label) });
}

const mixedControl = mobileNavigationForAuthority({
  role: "warehouse_operator",
  roles: ["warehouse_operator", "owner"],
  capabilities: ROLE_CAPABILITIES.owner,
});
assert.equal(mixedControl?.profile, "control", "A supervisory role must retain the control navigation even with an operational role");

assert.equal(mobileNavigationForAuthority({ role: "unknown", roles: [], capabilities: [] }), null, "Unknown roles must fail closed");
assert.equal(mobileNavigationForAuthority({ role: "warehouse_operator", roles: ["warehouse_operator"], capabilities: [] }), null, "Incomplete capability contracts must fail closed");

console.log(JSON.stringify({
  status: "PASS",
  source: "authority-server",
  roles: results.length,
  profiles: expectedLabels,
  results,
}, null, 2));
