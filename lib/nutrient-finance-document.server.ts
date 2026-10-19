import { env } from "cloudflare:workers";
import {
  normalizeNutrientSpatialOutput,
  type FinanceEvidenceSource,
} from "@/lib/finance-document-extraction-contract";

const NUTRIENT_PARSE_URL = "https://api.nutrient.io/extraction/parse";
const MAX_NUTRIENT_RESPONSE_BYTES = 5 * 1024 * 1024;

function nutrientApiKey() {
  const bound = (env as unknown as Record<string, unknown>).NUTRIENT_API_KEY;
  if (typeof bound === "string" && bound.trim()) return bound.trim();
  const local = process.env.NUTRIENT_API_KEY;
  return typeof local === "string" ? local.trim() : "";
}

export function isNutrientFinanceExtractionConfigured() {
  return Boolean(nutrientApiKey());
}

export class NutrientFinanceExtractionError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

async function readLimitedBody(response: Response) {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_NUTRIENT_RESPONSE_BYTES) {
    throw new NutrientFinanceExtractionError("nutrient_response_too_large");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytesRead = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    if (bytesRead > MAX_NUTRIENT_RESPONSE_BYTES) {
      await reader.cancel();
      throw new NutrientFinanceExtractionError("nutrient_response_too_large");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export type NutrientFinanceParseResult = {
  sources: FinanceEvidenceSource[];
  truncated: boolean;
  pagesProcessed: number | null;
  creditsUsed: number | null;
  requestId: string | null;
  mode: "structure";
};

export async function parseFinanceDocumentWithNutrient({
  fileName,
  mimeType,
  bytes,
}: {
  fileName: string;
  mimeType: string;
  bytes: ArrayBuffer;
}): Promise<NutrientFinanceParseResult> {
  const apiKey = nutrientApiKey();
  if (!apiKey) throw new NutrientFinanceExtractionError("nutrient_not_configured");

  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mimeType }), fileName);
  form.append("instructions", JSON.stringify({ mode: "structure", output: { format: "spatial" } }));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(NUTRIENT_PARSE_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    });
    const body = await readLimitedBody(response);
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new NutrientFinanceExtractionError("nutrient_credentials_rejected");
      if (response.status === 402) throw new NutrientFinanceExtractionError("nutrient_quota_exhausted");
      if (response.status === 429) throw new NutrientFinanceExtractionError("nutrient_rate_limited");
      throw new NutrientFinanceExtractionError("nutrient_provider_unavailable");
    }

    let payload: unknown;
    try {
      payload = JSON.parse(body) as unknown;
    } catch {
      throw new NutrientFinanceExtractionError("nutrient_response_invalid");
    }
    const root = jsonRecord(payload);
    const metrics = jsonRecord(root.metrics);
    const usage = jsonRecord(root.usage);
    const credits = jsonRecord(usage.data_extraction_credits);
    const normalized = normalizeNutrientSpatialOutput(payload);
    if (!normalized.sources.length) throw new NutrientFinanceExtractionError("nutrient_extraction_empty");
    return {
      sources: normalized.sources,
      truncated: normalized.truncated,
      pagesProcessed: typeof metrics.pagesProcessed === "number" && Number.isFinite(metrics.pagesProcessed) ? Math.max(0, metrics.pagesProcessed) : null,
      creditsUsed: typeof credits.cost === "number" && Number.isFinite(credits.cost) ? Math.max(0, credits.cost) : null,
      requestId: typeof root.requestId === "string" ? root.requestId.slice(0, 160) : response.headers.get("x-request-id"),
      mode: "structure",
    };
  } catch (error) {
    if (error instanceof NutrientFinanceExtractionError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new NutrientFinanceExtractionError("nutrient_request_timeout");
    throw new NutrientFinanceExtractionError("nutrient_provider_unavailable");
  } finally {
    clearTimeout(timeout);
  }
}
