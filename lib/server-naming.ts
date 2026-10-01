import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { entityCodeCounters, s04Records } from "@/db/schema";

export type NamingEntity = "commessa" | "asset" | "vehicle" | "equipment" | "material";

export type ServerNamingResult = {
  canonicalCode: string;
  namespace: string;
  sequence: number | null;
  source: "server" | "barcode";
};

export class CanonicalCodeConflictError extends Error {
  readonly code = "canonical_code_conflict";

  constructor() {
    super("canonical_code_conflict");
  }
}

const MATERIAL_STOP_WORDS = new Set([
  "A",
  "AL",
  "ALLA",
  "CON",
  "DA",
  "DAL",
  "DE",
  "DEL",
  "DELLA",
  "DI",
  "E",
  "GLI",
  "I",
  "IL",
  "IN",
  "LA",
  "LE",
  "LO",
  "PER",
  "SU",
]);

const DIMENSION_PATTERN = /(\d+(?:[.,]\d+)?)\s*[x×*]\s*(\d+(?:[.,]\d+)?)(?:\s*(mm|cm|m))?/gi;

function removeAccents(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function compactToken(value: string) {
  let token = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!token) return "";

  // Keep the readable stem used by the operational labels: CHIUSINI → CHIUS,
  // GHISA → GHIS. The final cap keeps generated codes short enough for labels.
  if (token.length > 5 && token.endsWith("INI")) token = token.slice(0, -3);
  else if (token.length > 4 && token.endsWith("I")) token = token.slice(0, -1);
  else if (token.length > 4 && token.endsWith("A")) token = token.slice(0, -1);

  return token.slice(0, 5);
}

export function materialCodeBase(description: string) {
  const dimensions: string[] = [];
  const withoutDimensions = removeAccents(description).replace(
    DIMENSION_PATTERN,
    (_match, width: string, height: string, unit?: string) => {
      const normalizedWidth = width.replace(",", ".");
      const normalizedHeight = height.replace(",", ".");
      dimensions.push(`${normalizedWidth}x${normalizedHeight}${unit?.toLowerCase() ?? ""}`);
      return " ";
    },
  );

  const words = withoutDimensions
    .toUpperCase()
    .match(/[A-Z0-9]+/g)
    ?.filter((word) => !MATERIAL_STOP_WORDS.has(word))
    .map(compactToken)
    .filter(Boolean)
    .slice(0, 3) ?? [];

  const parts = [...words, ...dimensions].filter(Boolean);
  return (parts.length ? parts : ["MAT"]).join("-").slice(0, 96);
}

function padded(value: number) {
  return String(value).padStart(4, "0");
}

async function nextSequence(tenantId: string, namespace: string) {
  const db = getDb();
  const [row] = await db
    .insert(entityCodeCounters)
    .values({ tenantId, namespace, lastValue: 1 })
    .onConflictDoUpdate({
      target: [entityCodeCounters.tenantId, entityCodeCounters.namespace],
      set: {
        lastValue: sql`${entityCodeCounters.lastValue} + 1`,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      },
    })
    .returning({ lastValue: entityCodeCounters.lastValue });

  const value = Number(row?.lastValue ?? 0);
  if (!Number.isInteger(value) || value < 1) throw new Error("identifier_counter_unavailable");
  return value;
}

async function codeIsTaken(tenantId: string, module: string, canonicalCode: string) {
  const db = getDb();
  const [row] = await db
    .select({ id: s04Records.id })
    .from(s04Records)
    .where(and(
      eq(s04Records.tenantId, tenantId),
      eq(s04Records.module, module),
      eq(s04Records.canonicalCode, canonicalCode),
    ))
    .limit(1);
  return Boolean(row);
}

async function availableSequentialCode(
  tenantId: string,
  module: string,
  namespace: string,
  prefix: string,
  base: string | null = null,
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const sequence = await nextSequence(tenantId, namespace);
    const canonicalCode = base
      ? sequence === 1 ? base : `${base}-${padded(sequence)}`
      : `${prefix}-${padded(sequence)}`;
    if (!(await codeIsTaken(tenantId, module, canonicalCode))) {
      return { canonicalCode, sequence };
    }
  }
  throw new Error("identifier_counter_exhausted");
}

export async function allocateServerName({
  tenantId,
  module,
  entityType,
  description,
  barcode,
}: {
  tenantId: string;
  module: "operations" | "assets" | "warehouse";
  entityType?: string;
  description: string;
  barcode?: string;
}): Promise<ServerNamingResult | null> {
  const normalizedType: NamingEntity = module === "operations"
    ? "commessa"
    : module === "warehouse"
      ? "material"
      : entityType === "vehicle" || entityType === "equipment" ? entityType : "asset";

  if (normalizedType !== "commessa" && barcode) {
    if (await codeIsTaken(tenantId, module, barcode)) throw new CanonicalCodeConflictError();
    return { canonicalCode: barcode, namespace: `${normalizedType}:barcode`, sequence: null, source: "barcode" };
  }

  const config: Record<Exclude<NamingEntity, "material">, { namespace: string; prefix: string }> = {
    commessa: { namespace: "operations", prefix: "COMM" },
    asset: { namespace: "assets", prefix: "ASSET" },
    vehicle: { namespace: "vehicles", prefix: "MEZZI" },
    equipment: { namespace: "equipment", prefix: "ATT" },
  };

  if (normalizedType === "material") {
    const base = materialCodeBase(description);
    const result = await availableSequentialCode(tenantId, module, `materials:${base}`, "MAT", base);
    return { ...result, namespace: `materials:${base}`, source: "server" };
  }

  const result = await availableSequentialCode(
    tenantId,
    module,
    config[normalizedType].namespace,
    config[normalizedType].prefix,
  );
  return { ...result, namespace: config[normalizedType].namespace, source: "server" };
}
