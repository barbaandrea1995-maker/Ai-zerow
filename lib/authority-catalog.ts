export const ROLE_CAPABILITIES = {
  owner: ["workforce.read", "workforce.write", "workforce.read.all", "tenant.manage", "command.read", "approvals.review", "operations.read", "operations.write", "finance.read", "field.read", "field.write", "warehouse.read", "warehouse.write", "mission.read", "mission.write", "documents.read", "planning.read", "planning.write", "workforce.registry.read", "workforce.manage", "asset.read", "asset.write", "finance.write", "procurement.write", "documents.write", "communication.read", "communication.send", "communication.broadcast.critical", "telephony.manage"],
  admin: ["workforce.read", "workforce.write", "workforce.read.all", "command.read", "approvals.review", "operations.read", "operations.write", "finance.read", "field.read", "field.write", "warehouse.read", "warehouse.write", "mission.read", "mission.write", "documents.read", "planning.read", "planning.write", "workforce.registry.read", "workforce.manage", "asset.read", "asset.write", "finance.write", "procurement.write", "documents.write", "communication.read", "communication.send", "communication.broadcast.critical", "telephony.manage"],
  member: ["workforce.read", "workforce.write", "command.read", "operations.read", "field.read", "field.write", "warehouse.read", "mission.read", "planning.read", "documents.read"],
  manager: ["workforce.read", "workforce.write", "workforce.read.all", "command.read", "approvals.review", "operations.read", "operations.write", "finance.read", "field.read", "field.write", "warehouse.read", "warehouse.write", "mission.read", "mission.write", "documents.read", "planning.read", "planning.write", "workforce.registry.read", "workforce.manage", "asset.read", "asset.write", "finance.write", "procurement.write", "documents.write", "communication.read", "communication.send", "communication.broadcast.critical"],
  office: ["workforce.read", "workforce.write", "workforce.read.all", "command.read", "approvals.review", "operations.read", "operations.write", "finance.read", "field.read", "warehouse.read", "mission.read", "documents.read", "planning.read", "planning.write", "workforce.registry.read", "workforce.manage", "asset.read", "finance.write", "procurement.write", "documents.write", "communication.read", "communication.send"],
  technical: ["workforce.read", "workforce.write", "command.read", "operations.read", "operations.write", "finance.read", "field.read", "field.write", "warehouse.read", "mission.read", "documents.read", "planning.read", "planning.write", "workforce.registry.read", "workforce.manage", "asset.read", "asset.write", "documents.write", "communication.read", "communication.send"],
  field_supervisor: ["workforce.read", "workforce.write", "command.read", "operations.read", "field.read", "field.write", "warehouse.read", "mission.read", "planning.read", "workforce.registry.read", "asset.read", "documents.read", "communication.read", "communication.send", "communication.broadcast.critical"],
  worker: ["workforce.read", "workforce.write", "operations.read", "field.read", "field.write", "warehouse.read", "mission.read", "documents.read", "communication.read", "communication.send"],
  warehouse_manager: ["workforce.read", "workforce.write", "command.read", "operations.read", "warehouse.read", "warehouse.write", "mission.read", "mission.write", "asset.read", "documents.read", "communication.read", "communication.send", "communication.broadcast.critical"],
  warehouse_operator: ["workforce.read", "workforce.write", "operations.read", "warehouse.read", "warehouse.write", "mission.read", "asset.read", "documents.read", "communication.read", "communication.send"],
  driver: ["workforce.read", "workforce.write", "operations.read", "warehouse.read", "mission.read", "mission.write", "asset.read", "documents.read", "communication.read", "communication.send"],
  maintenance: ["workforce.read", "workforce.write", "field.read", "asset.read", "asset.write", "documents.read", "communication.read", "communication.send"],
  auditor: ["workforce.read", "workforce.read.all", "command.read", "operations.read", "finance.read", "field.read", "warehouse.read", "mission.read", "planning.read", "workforce.registry.read", "asset.read", "documents.read"],
} as const;

export type AuthorityRole = keyof typeof ROLE_CAPABILITIES;

export const AUTHORITY_ROLES = Object.keys(ROLE_CAPABILITIES) as AuthorityRole[];

export function isAuthorityRole(value: string): value is AuthorityRole {
  return Object.prototype.hasOwnProperty.call(ROLE_CAPABILITIES, value);
}
