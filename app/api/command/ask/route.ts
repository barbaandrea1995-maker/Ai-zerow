import { getDb } from "@/db";
import { s07AiLedger } from "@/db/schema";
import {
  getS07Context,
  getS07Ledger,
  s07AccessDenied,
  s07Envelope,
  s07Error,
} from "@/lib/s07-adapter";

export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export async function POST(request: Request) {
  const context = await getS07Context();
  const denied = s07AccessDenied(context, "write");
  if (denied) return denied;

  let payload: Record<string, unknown>;
  try {
    const parsed = (await request.json()) as unknown;
    if (!isRecord(parsed)) return Response.json({ error: "invalid_json" }, { status: 400 });
    payload = parsed;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const command = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
  const requestedAction = typeof payload.actionType === "string" ? payload.actionType.trim().slice(0, 64) : "query";
  const actionType = requestedAction || "query";
  const approvalRequired = !["query", "read", "overview"].includes(actionType.toLowerCase());
  if (command.length < 2 || command.length > 500) {
    return Response.json({ error: "prompt_must_be_2_to_500_characters" }, { status: 400 });
  }

  try {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const db = getDb();
    const [row] = await db.insert(s07AiLedger).values({
      id,
      tenantId: context!.tenantId,
      entryType: "command_preview",
      actionType,
      command,
      status: approvalRequired ? "PENDING_APPROVAL" : "PREVIEW_ONLY",
      approvalRequired: approvalRequired ? 1 : 0,
      payloadJson: JSON.stringify({
        source: "sites-s07-adapter",
        directWrite: false,
        runtime: "external-openai-runtime-deferred",
        requestedPayload: payload.payload && isRecord(payload.payload) ? payload.payload : {},
      }),
      requestedBy: context!.actorId,
      readbackJson: JSON.stringify({ status: "SITES_LEDGER_VERIFIED", checkedAt: now }),
      createdAt: now,
    }).returning();
    const rows = await getS07Ledger(context!.tenantId);
    return Response.json({
      ...s07Envelope(context!, rows),
      result: {
        actionId: id,
        status: row.status,
        approvalRequired,
        directWrite: false,
        message: approvalRequired
          ? "Preview registrata. Serve una decisione di approvazione prima di qualsiasi adapter esterno."
          : "Preview registrata. Il runtime AI esterno non è collegato; nessuna scrittura è stata eseguita.",
      },
    }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: s07Error(error) }, { status: 503 });
  }
}
