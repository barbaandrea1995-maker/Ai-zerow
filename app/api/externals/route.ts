import {
  appendExternalCheck,
  externalAccessDenied,
  externalEnvelope,
  externalError,
  getExternalContext,
  getExternalSnapshot,
} from "@/lib/external-adapter";

export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export async function GET() {
  const context = await getExternalContext();
  const denied = externalAccessDenied(context, "read");
  if (denied) return denied;

  try {
    const snapshot = await getExternalSnapshot(context!.tenantId);
    return Response.json(externalEnvelope(context!, snapshot), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return Response.json({ error: externalError(error) }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const context = await getExternalContext();
  const denied = externalAccessDenied(context, "write");
  if (denied) return denied;

  let payload: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!isRecord(parsed)) return Response.json({ error: "invalid_json" }, { status: 400 });
    payload = parsed;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  try {
    const result = await appendExternalCheck(context!, payload);
    return Response.json({
      ...externalEnvelope(context!, result.snapshot),
      created: result.created,
    }, {
      status: 201,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    if (error instanceof Error && [
      "unknown_external_adapter",
      "invalid_check_type",
      "invalid_check_result",
      "detail_must_be_2_to_240_characters",
      "evidence_too_long",
    ].includes(error.message)) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return Response.json({ error: externalError(error) }, { status: 503 });
  }
}
