import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { s05Records } from "@/db/schema";
import {
  getAuthorityContext,
  hasCapability,
  publicAuthorityContext,
  type AuthorityContext,
} from "@/lib/authority-context";

export const EXTERNALS_MODULE = "externals";

export type ExternalStatus = "READY" | "DEFERRED" | "BLOCKED" | "NOT_RUN";
export type ExternalAuthorization = "AUTHORIZED" | "NOT_AUTHORIZED";
export type ExternalCheckResult = "DECLARATIVE_PASS" | "BLOCKED" | "NOT_RUN";
export type ExternalCheckType = "contract" | "health" | "readback" | "gate";

export type ExternalAdapterDefinition = {
  key: string;
  tranche: string;
  family: string;
  title: string;
  provider: string;
  boundary: "sites-native" | "adapter-required" | "forbidden-dependency" | "not-in-sites-scope";
  status: ExternalStatus;
  authorization?: ExternalAuthorization;
  contract: string;
  gate: string;
  capabilities: string[];
  nextAction: string;
};

export type ExternalCheck = {
  id: string;
  adapterKey: string;
  checkType: ExternalCheckType;
  result: ExternalCheckResult;
  detail: string;
  evidence: string;
  source: string;
  checkedAt: string;
};

/**
 * Declarative catalog of every external boundary found in the reconstruction.
 * It stores no endpoint, secret or provider credential.
 */
export const EXTERNAL_ADAPTERS: ExternalAdapterDefinition[] = [
  {
    key: "sites-command-core",
    tranche: "S01–S08",
    family: "sites",
    title: "Sites command core",
    provider: "@Sites",
    boundary: "sites-native",
    status: "READY",
    contract: "Authority context → D1 → API → carbon UI readback",
    gate: "S01–S08 Sites surface and D1 readback verified",
    capabilities: ["owner auth", "D1 readback", "append-only", "PWA surface"],
    nextAction: "Keep as the local control plane",
  },
  {
    key: "authority-identity",
    tranche: "S02",
    family: "identity",
    title: "Authority identity adapter",
    provider: "Identity / tenant provider",
    boundary: "adapter-required",
    status: "DEFERRED",
    contract: "Session, tenant identity, role resolution and membership sync",
    gate: "External identity evidence must preserve Sites tenant scope",
    capabilities: ["session", "tenant", "roles", "membership"],
    nextAction: "Attach only with an authorized identity contract",
  },
  {
    key: "canonical-domain-services",
    tranche: "S04–S05",
    family: "domain",
    title: "Canonical domain services",
    provider: "ZEROW domain services",
    boundary: "adapter-required",
    status: "DEFERRED",
    contract: "Operations, workforce, documents, finance and procurement state",
    gate: "External readback and mutation parity, with no invented state machine",
    capabilities: ["jobs", "workforce", "documents", "finance", "procurement"],
    nextAction: "Bind readback first, then approval-gated writes",
  },
  {
    key: "document-storage-ocr",
    tranche: "S05",
    family: "storage",
    title: "Document storage and OCR",
    provider: "Document storage / OCR service",
    boundary: "adapter-required",
    status: "DEFERRED",
    contract: "Upload, provenance, OCR extraction and evidence links",
    gate: "File identity and provenance must survive external round-trip",
    capabilities: ["upload", "OCR", "provenance", "evidence"],
    nextAction: "Keep document proposals append-only until bound",
  },
  {
    key: "neon-schema-binding",
    tranche: "S10",
    family: "data",
    title: "Canonical schema and migrations",
    provider: "Neon",
    boundary: "adapter-required",
    status: "DEFERRED",
    authorization: "AUTHORIZED",
    contract: "Authorized Neon project binding → read-only Sites runtime, schema fingerprint, migration markers 0016/0017 and environment binding",
    gate: "Direct schema, structural 0016/0017 markers and exact-SHA runtime readback recorded; marker provenance, neon_auth read scope and Auth/tenant fixtures still required",
    capabilities: ["schema fingerprint", "migration markers", "environment binding"],
    nextAction: "Resolve the least-privilege neon_auth read scope and marker provenance; keep D1 canonical until Auth/tenant fixtures pass",
  },
  {
    key: "event-consumer",
    tranche: "S06",
    family: "events",
    title: "Event consumer / retry / DLQ",
    provider: "External worker and consumer",
    boundary: "adapter-required",
    status: "DEFERRED",
    contract: "Outbox delivery, retries, dead-letter handling and reconciliation",
    gate: "Consumer delivery evidence must match the Sites event idempotency key",
    capabilities: ["consume", "retry", "DLQ", "reconcile"],
    nextAction: "Consume the Sites outbox without bypassing the ledger",
  },
  {
    key: "openai-runtime",
    tranche: "S07",
    family: "ai",
    title: "AI runtime and tool gateway",
    provider: "OpenAI runtime",
    boundary: "adapter-required",
    status: "DEFERRED",
    contract: "Command preview, approval, tool call and governed readback",
    gate: "No direct write; every mutating action remains approval-gated",
    capabilities: ["reasoning", "tools", "approval", "readback"],
    nextAction: "Connect a runtime only through the existing ledger contract",
  },
  {
    key: "voice-telephony",
    tranche: "S07",
    family: "ai",
    title: "Voice and telephony adapter",
    provider: "Voice / telephony services",
    boundary: "adapter-required",
    status: "DEFERRED",
    contract: "Call identity, transcript, consent and command handoff",
    gate: "Caller identity and consent must enter the same approval boundary",
    capabilities: ["voice", "telephony", "transcript", "consent"],
    nextAction: "Design the consent contract before connector work",
  },
  {
    key: "policy-engine",
    tranche: "S05",
    family: "governance",
    title: "Canonical policy engine",
    provider: "External policy service",
    boundary: "adapter-required",
    status: "DEFERRED",
    contract: "Policy evaluation, explainability and audit decision",
    gate: "Policy result must be attributable to versioned rules",
    capabilities: ["evaluate", "explain", "version", "audit"],
    nextAction: "Keep Sites authority as the enforced local gate",
  },
  {
    key: "runtime-parity",
    tranche: "S11",
    family: "runtime",
    title: "Runtime and deployment parity",
    provider: "Vercel / GitHub runtime",
    boundary: "forbidden-dependency",
    status: "BLOCKED",
    contract: "Same SHA, environment bindings and runtime logs across platforms",
    gate: "Exact SHA parity and no runtime configuration errors",
    capabilities: ["build identity", "environment", "logs", "promotion"],
    nextAction: "Excluded by the Sites-only operating rule",
  },
  {
    key: "native-mobile",
    tranche: "S12",
    family: "mobile",
    title: "Native iOS / Android adapter",
    provider: "Capacitor / native plugins",
    boundary: "not-in-sites-scope",
    status: "NOT_RUN",
    contract: "Native shell, secure storage, push and device lifecycle",
    gate: "Separate native plan; PWA evidence cannot certify native behavior",
    capabilities: ["iOS", "Android", "secure storage", "push"],
    nextAction: "Plan separately if native distribution becomes required",
  },
  {
    key: "certification-harness",
    tranche: "S13",
    family: "certification",
    title: "B0–B10 / W20 certification harness",
    provider: "Browser / device / CI harness",
    boundary: "adapter-required",
    status: "NOT_RUN",
    contract: "Exact SHA, browser/device evidence and no hidden NOT_RUN state",
    gate: "Every B0–B10/W20 item has evidence or an explicit blocker",
    capabilities: ["browser", "device", "CI", "evidence"],
    nextAction: "Run only against an authorized exact-SHA test harness",
  },
  {
    key: "sites-promotion",
    tranche: "S14",
    family: "promotion",
    title: "Sites private promotion",
    provider: "@Sites",
    boundary: "sites-native",
    status: "READY",
    contract: "Owner-only saved version, archive and production URL",
    gate: "Published Sites version is the same source state as the archive",
    capabilities: ["save version", "private deploy", "readback"],
    nextAction: "Continue publishing through @Sites only",
  },
  {
    key: "external-promotion",
    tranche: "S14",
    family: "promotion",
    title: "External production promotion",
    provider: "Authorized external deployment workflow",
    boundary: "forbidden-dependency",
    status: "BLOCKED",
    contract: "Production alias, integrated SHA and rollback evidence",
    gate: "W20 verified and production alias points to the integrated SHA",
    capabilities: ["promotion", "alias", "rollback", "evidence"],
    nextAction: "Remain blocked while external platforms are excluded",
  },
];

const CHECK_TYPES = new Set<ExternalCheckType>(["contract", "health", "readback", "gate"]);
const CHECK_RESULTS = new Set<ExternalCheckResult>(["DECLARATIVE_PASS", "BLOCKED", "NOT_RUN"]);

export class ExternalAdapterInputError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export function isExternalAdapterKey(value: string): boolean {
  return EXTERNAL_ADAPTERS.some((adapter) => adapter.key === value);
}

export function getExternalAdapter(key: string): ExternalAdapterDefinition | undefined {
  return EXTERNAL_ADAPTERS.find((adapter) => adapter.key === key);
}

export function externalAccessDenied(
  context: AuthorityContext | null,
  operation: "read" | "write",
): Response | null {
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const capability = operation === "write" ? "tenant.manage" : "command.read";
  if (!hasCapability(context, capability)) {
    return Response.json({ error: "forbidden", operation }, { status: 403 });
  }
  return null;
}

export function externalError(error: unknown): string {
  const message = error instanceof Error ? error.message : "unexpected_error";
  return message.includes("no such table") || message.includes("s05_records")
    ? "external_registry_store_unavailable"
    : "external_registry_readback_failed";
}

function parsePayload(payloadJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(payloadJson) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function textValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function checkFromRow(row: typeof s05Records.$inferSelect): ExternalCheck | null {
  const payload = parsePayload(row.payloadJson);
  const adapterKey = textValue(payload.adapterKey);
  const checkType = textValue(payload.checkType) as ExternalCheckType;
  const result = textValue(payload.result) as ExternalCheckResult;
  if (!isExternalAdapterKey(adapterKey) || !CHECK_TYPES.has(checkType) || !CHECK_RESULTS.has(result)) {
    return null;
  }
  return {
    id: row.id,
    adapterKey,
    checkType,
    result,
    detail: textValue(payload.detail, row.detail),
    evidence: textValue(payload.evidence),
    source: textValue(payload.source, "sites-d1-external-registry"),
    checkedAt: textValue(payload.checkedAt, row.updatedAt),
  };
}

export function checkForResponse(row: typeof s05Records.$inferSelect): ExternalCheck | null {
  return checkFromRow(row);
}

function effectiveStatus(adapter: ExternalAdapterDefinition, lastCheck: ExternalCheck | null): ExternalStatus {
  if (!lastCheck) return adapter.status;
  if (lastCheck.result === "DECLARATIVE_PASS") return adapter.status;
  if (lastCheck.result === "BLOCKED") return "BLOCKED";
  return "NOT_RUN";
}

export async function getExternalSnapshot(tenantId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(s05Records)
    .where(and(eq(s05Records.tenantId, tenantId), eq(s05Records.module, EXTERNALS_MODULE)))
    .orderBy(desc(s05Records.updatedAt));

  const checks = rows
    .filter((row) => row.recordType === "external-check")
    .map(checkFromRow)
    .filter((check): check is ExternalCheck => Boolean(check));
  const latestByAdapter = new Map<string, ExternalCheck>();
  for (const check of checks) {
    if (!latestByAdapter.has(check.adapterKey)) latestByAdapter.set(check.adapterKey, check);
  }

  const adapters = EXTERNAL_ADAPTERS.map((adapter) => ({
    ...adapter,
    effectiveStatus: effectiveStatus(adapter, latestByAdapter.get(adapter.key) ?? null),
    lastCheck: latestByAdapter.get(adapter.key) ?? null,
  }));
  const count = (status: ExternalStatus) => adapters.filter((adapter) => adapter.effectiveStatus === status).length;

  return {
    adapters,
    checks,
    summary: {
      total: adapters.length,
      ready: count("READY"),
      deferred: count("DEFERRED"),
      blocked: count("BLOCKED"),
      notRun: count("NOT_RUN"),
    },
    readback: {
      status: "ok" as const,
      source: "sites-d1-bounded-adapter",
      persistedChecks: checks.length,
      catalogEntries: adapters.length,
      checkedAt: new Date().toISOString(),
    },
  };
}

export async function getExternalContext() {
  return getAuthorityContext();
}

export function externalEnvelope(
  context: AuthorityContext,
  snapshot: Awaited<ReturnType<typeof getExternalSnapshot>>,
) {
  return {
    context: publicAuthorityContext(context),
    contract: {
      tranche: "S10–S14",
      source: "sites-d1-external-adapter-registry",
      mode: "declarative-only",
      storage: "s05_records append-only check log",
      secrets: "never persisted",
      directExternalWrite: false,
      nativeBoundary: "@Sites only",
      readback: "sites-d1-verified",
    },
    ...snapshot,
  };
}

export async function appendExternalCheck(
  context: AuthorityContext,
  input: Record<string, unknown>,
) {
  const adapterKey = textValue(input.adapterKey).trim();
  const adapter = getExternalAdapter(adapterKey);
  if (!adapter) throw new ExternalAdapterInputError("unknown_external_adapter");

  const checkType = textValue(input.checkType, "contract").trim() as ExternalCheckType;
  if (!CHECK_TYPES.has(checkType)) throw new ExternalAdapterInputError("invalid_check_type");

  const result = textValue(input.result, "NOT_RUN").trim() as ExternalCheckResult;
  if (!CHECK_RESULTS.has(result)) throw new ExternalAdapterInputError("invalid_check_result");

  const detail = textValue(input.detail, checkType + " · " + result).trim();
  const evidence = textValue(input.evidence).trim();
  if (detail.length < 2 || detail.length > 240) {
    throw new ExternalAdapterInputError("detail_must_be_2_to_240_characters");
  }
  if (evidence.length > 360) throw new ExternalAdapterInputError("evidence_too_long");

  const now = new Date().toISOString();
  const id = "EXT-" + adapterKey.toUpperCase().replace(/[^A-Z0-9]+/g, "-") + "-" + crypto.randomUUID().slice(0, 8).toUpperCase();
  const db = getDb();
  const [row] = await db.insert(s05Records).values({
    id,
    tenantId: context.tenantId,
    module: EXTERNALS_MODULE,
    recordType: "external-check",
    title: adapter.title,
    detail,
    meta: adapter.tranche + " · " + adapter.provider,
    status: result,
    tone: result === "DECLARATIVE_PASS" ? "lime" : result === "BLOCKED" ? "red" : "amber",
    progress: result === "DECLARATIVE_PASS" ? 100 : result === "BLOCKED" ? 24 : 0,
    payloadJson: JSON.stringify({
      source: "sites-ui-declarative",
      adapterKey,
      checkType,
      result,
      detail,
      evidence,
      checkedAt: now,
      directExternalWrite: false,
    }),
    createdBy: context.actorId,
    createdAt: now,
    updatedAt: now,
  }).returning();

  return { created: checkForResponse(row), snapshot: await getExternalSnapshot(context.tenantId) };
}
