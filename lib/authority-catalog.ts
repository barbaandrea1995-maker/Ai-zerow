const PLATFORM = ["settings.read", "pwa.read"];
const COMMAND = ["command.read", "command.customize", "analytics.read", "events.read"];
const EVENTS_WRITE = ["events.write"];
const AUTHORITY_VIEW = ["authority.read"];
const AUTHORITY_MANAGE = ["authority.read", "authority.manage", "onboarding.manage"];
const OPERATIONS_READ = ["operations.read"];
const OPERATIONS_WRITE = ["operations.read", "operations.write"];
const WORKFORCE_SELF = ["workforce.read", "workforce.write"];
const WORKFORCE_MANAGE = ["workforce.read", "workforce.write", "workforce.read.all", "workforce.registry.read", "workforce.manage"];
const FIELD = ["field.read", "field.write"];
const ATTENDANCE_SELF = ["attendance.self"];
const ATTENDANCE_READ = ["attendance.read"];
const ATTENDANCE_MANAGE = ["attendance.read", "attendance.manage", "attendance.approve"];
const WAREHOUSE_READ = ["warehouse.read"];
const WAREHOUSE_REQUEST = ["warehouse.read", "warehouse.request"];
const WAREHOUSE_WRITE = ["warehouse.read", "warehouse.request", "warehouse.write"];
const WAREHOUSE_REGISTER = [...WAREHOUSE_WRITE, "warehouse.register"];
const MISSION_READ = ["mission.read"];
const MISSION_WRITE = ["mission.read", "mission.write"];
const DOCUMENTS_READ = ["documents.read"];
const DOCUMENTS_WRITE = ["documents.read", "documents.write"];
const PLANNING_READ = ["planning.read"];
const PLANNING_WRITE = ["planning.read", "planning.write"];
const ASSET_READ = ["asset.read"];
const ASSET_WRITE = ["asset.read", "asset.write"];
const FINANCE_READ = ["finance.read"];
const FINANCE_WRITE = ["finance.read", "finance.write"];
const PROCUREMENT_READ = ["procurement.read"];
const PROCUREMENT_WRITE = ["procurement.read", "procurement.write"];
const COMMUNICATION = ["communication.read", "communication.send"];
const COMMUNICATION_CRITICAL = ["communication.read", "communication.send", "communication.broadcast.critical"];
const QR_READ = ["qr.read"];
const QR_WRITE = ["qr.read", "qr.write"];
const GOVERNANCE = ["governance.read", "approvals.review"];
const EXTERNALS = ["external_adapters.read"];

function capabilitySet(...groups: readonly string[][]) {
  return Array.from(new Set(groups.flat()));
}

export const ROLE_CAPABILITIES = {
  owner: capabilitySet(
    PLATFORM, COMMAND, AUTHORITY_MANAGE, OPERATIONS_WRITE, WORKFORCE_MANAGE, ATTENDANCE_MANAGE,
    FIELD, WAREHOUSE_REGISTER, MISSION_WRITE, DOCUMENTS_WRITE, PLANNING_WRITE,
    ASSET_WRITE, FINANCE_WRITE, PROCUREMENT_WRITE, COMMUNICATION_CRITICAL,
    QR_WRITE, GOVERNANCE, EXTERNALS, EVENTS_WRITE, ["tenant.manage", "telephony.manage"],
  ),
  admin: capabilitySet(
    PLATFORM, COMMAND, AUTHORITY_MANAGE, OPERATIONS_WRITE, WORKFORCE_MANAGE, ATTENDANCE_MANAGE,
    FIELD, WAREHOUSE_REGISTER, MISSION_WRITE, DOCUMENTS_WRITE, PLANNING_WRITE,
    ASSET_WRITE, FINANCE_WRITE, PROCUREMENT_WRITE, COMMUNICATION_CRITICAL,
    QR_WRITE, GOVERNANCE, EXTERNALS, EVENTS_WRITE, ["telephony.manage"],
  ),
  member: capabilitySet(
    PLATFORM, COMMAND, OPERATIONS_READ, WORKFORCE_SELF, ATTENDANCE_SELF, FIELD, WAREHOUSE_REQUEST,
    MISSION_READ, DOCUMENTS_READ, PLANNING_READ, COMMUNICATION, QR_READ,
  ),
  manager: capabilitySet(
    PLATFORM, COMMAND, AUTHORITY_VIEW, OPERATIONS_WRITE, WORKFORCE_MANAGE, ATTENDANCE_MANAGE,
    FIELD, WAREHOUSE_REGISTER, MISSION_WRITE, DOCUMENTS_WRITE, PLANNING_WRITE,
    ASSET_WRITE, FINANCE_WRITE, PROCUREMENT_WRITE, COMMUNICATION_CRITICAL,
    QR_WRITE, GOVERNANCE, EXTERNALS, EVENTS_WRITE,
  ),
  office: capabilitySet(
    PLATFORM, COMMAND, AUTHORITY_VIEW, OPERATIONS_WRITE, WORKFORCE_MANAGE, ATTENDANCE_MANAGE,
    ["field.read"], WAREHOUSE_READ, MISSION_READ, DOCUMENTS_WRITE,
    PLANNING_WRITE, ASSET_READ, FINANCE_WRITE, PROCUREMENT_WRITE,
    COMMUNICATION, QR_WRITE, GOVERNANCE,
  ),
  technical: capabilitySet(
    PLATFORM, COMMAND, OPERATIONS_WRITE, WORKFORCE_SELF, ATTENDANCE_SELF, FIELD, WAREHOUSE_REQUEST,
    MISSION_READ, DOCUMENTS_WRITE, PLANNING_WRITE, ASSET_WRITE, FINANCE_READ,
    PROCUREMENT_READ, COMMUNICATION, QR_WRITE,
  ),
  field_supervisor: capabilitySet(
    PLATFORM, COMMAND, OPERATIONS_READ, WORKFORCE_SELF, ATTENDANCE_READ, ATTENDANCE_MANAGE, FIELD, WAREHOUSE_REQUEST,
    MISSION_READ, DOCUMENTS_READ, PLANNING_READ, ["workforce.registry.read"],
    ASSET_READ, COMMUNICATION_CRITICAL, QR_READ,
  ),
  worker: capabilitySet(
    PLATFORM, OPERATIONS_READ, WORKFORCE_SELF, ATTENDANCE_SELF, FIELD, WAREHOUSE_REQUEST,
    MISSION_READ, DOCUMENTS_READ, COMMUNICATION, QR_READ,
  ),
  warehouse_manager: capabilitySet(
    PLATFORM, COMMAND, OPERATIONS_READ, WORKFORCE_SELF, ATTENDANCE_SELF, WAREHOUSE_REGISTER,
    MISSION_WRITE, ASSET_READ, DOCUMENTS_READ, COMMUNICATION_CRITICAL, QR_WRITE,
  ),
  warehouse_operator: capabilitySet(
    PLATFORM, OPERATIONS_READ, WORKFORCE_SELF, ATTENDANCE_SELF, WAREHOUSE_WRITE, MISSION_READ,
    ASSET_READ, DOCUMENTS_READ, COMMUNICATION, QR_WRITE,
  ),
  driver: capabilitySet(
    PLATFORM, OPERATIONS_READ, WORKFORCE_SELF, ATTENDANCE_SELF, WAREHOUSE_READ, MISSION_WRITE,
    ASSET_READ, DOCUMENTS_READ, COMMUNICATION, QR_READ,
  ),
  maintenance: capabilitySet(
    PLATFORM, WORKFORCE_SELF, ATTENDANCE_SELF, FIELD, WAREHOUSE_REQUEST, ASSET_WRITE, DOCUMENTS_READ,
    COMMUNICATION, QR_READ,
  ),
  auditor: capabilitySet(
    PLATFORM, ["command.read", "analytics.read", "events.read"], AUTHORITY_VIEW,
    OPERATIONS_READ, ["workforce.read", "workforce.read.all", "workforce.registry.read"], ATTENDANCE_READ,
    ["field.read"], WAREHOUSE_READ, MISSION_READ, DOCUMENTS_READ,
    PLANNING_READ, ASSET_READ, FINANCE_READ, PROCUREMENT_READ, QR_READ,
    GOVERNANCE, EXTERNALS,
  ),
} as const;

export const ROLE_METADATA = {
  owner: { label: "Owner", purpose: "Controllo tenant, sicurezza e configurazione completa." },
  admin: { label: "Amministratore", purpose: "Amministrazione operativa senza trasferimento della proprieta tenant." },
  member: { label: "Collaboratore", purpose: "Operativita trasversale di base nel proprio perimetro." },
  manager: { label: "Manager", purpose: "Coordinamento operativo, economico e approvativo." },
  office: { label: "Ufficio", purpose: "Commesse, documenti, pianificazione e amministrazione." },
  technical: { label: "Tecnico", purpose: "Lavorazioni, pianificazione tecnica, asset e documenti." },
  field_supervisor: { label: "Caposquadra", purpose: "Coordinamento field e visibilita del team assegnato." },
  worker: { label: "Operatore", purpose: "Esecuzione sul campo nel solo perimetro assegnato." },
  warehouse_manager: { label: "Responsabile magazzino", purpose: "Anagrafica materiali, scorte, movimenti, missioni e controllo deposito." },
  warehouse_operator: { label: "Magazziniere", purpose: "Movimenti, prelievi, carichi e operatività autorizzata senza creare anagrafiche materiali." },
  driver: { label: "Autista", purpose: "Missioni, mezzi e documenti di trasporto assegnati." },
  maintenance: { label: "Manutentore", purpose: "Asset, manutenzione ed evidenze tecniche assegnate." },
  auditor: { label: "Auditor", purpose: "Lettura trasversale, evidenze e controllo senza scrittura." },
} as const;

export type AuthorityRole = keyof typeof ROLE_CAPABILITIES;

export const AUTHORITY_ROLES = Object.keys(ROLE_CAPABILITIES) as AuthorityRole[];

export function isAuthorityRole(value: string): value is AuthorityRole {
  return Object.prototype.hasOwnProperty.call(ROLE_CAPABILITIES, value);
}

/**
 * Memberships were originally single-role rows. Keep those rows readable and
 * normalize the new multi-mansione payload into a de-duplicated canonical set.
 */
export function normalizeAuthorityRoles(value: unknown, fallback: unknown = "member"): AuthorityRole[] {
  let candidates: unknown[] = [];
  if (Array.isArray(value)) {
    candidates = value;
  } else if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown;
      candidates = Array.isArray(parsed) ? parsed : [value];
    } catch {
      candidates = [value];
    }
  }
  if (candidates.length === 0 && typeof fallback === "string") candidates = [fallback];
  return Array.from(new Set(candidates.filter((item): item is AuthorityRole => typeof item === "string" && isAuthorityRole(item))));
}

export function authorityRolesJson(roles: readonly AuthorityRole[]) {
  return JSON.stringify(Array.from(new Set(roles)));
}
