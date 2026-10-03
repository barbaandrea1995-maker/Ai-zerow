import { and, eq, or } from "drizzle-orm";
import { getDb } from "@/db";
import { s04Records } from "@/db/schema";
import { GET as read, POST as write } from "@/app/api/s05/[module]/route";
import { getAuthorityContext, hasCapability } from "@/lib/authority-context";

export const GET = (request: Request) => read(request, { params: Promise.resolve({ module: "communications" }) });

const RECORD_TYPES = new Set(["SHIFT_BRIEFING", "TEAM_BROADCAST", "ACK_REQUEST", "VOICE_PROPOSAL"]);
const CHANNELS = new Set(["IN_APP", "PUSH", "EMAIL", "VOICE"]);
const AUDIENCES = new Set(["TENANT", "TEAM", "ROLE", "JOB"]);

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function bounded(value: unknown, max: number, fallback = "") {
  return text(value, fallback).slice(0, max);
}

function bool(value: unknown) {
  return value === true || value === "true";
}

export async function POST(request: Request) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "communication.send")) {
    return Response.json({ error: "forbidden", capability: "communication.send" }, { status: 403 });
  }

  let input: Record<string, unknown>;
  try {
    const parsed = await request.json() as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return Response.json({ error: "invalid_json" }, { status: 400 });
    }
    input = parsed as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const title = bounded(input.title, 120);
  const detail = bounded(input.detail ?? input.body, 300);
  const recordType = bounded(input.recordType, 32, "TEAM_BROADCAST").toUpperCase();
  const channel = bounded(input.channel, 16, "IN_APP").toUpperCase();
  const audienceType = bounded(input.audienceType, 16, "TENANT").toUpperCase();
  const audienceRef = bounded(input.audienceRef, 160);
  const jobRef = bounded(input.jobId, 160);
  const requiresAcknowledgement = bool(input.requiresAcknowledgement);

  if (title.length < 2) return Response.json({ error: "title_must_be_2_to_120_characters" }, { status: 400 });
  if (detail.length < 2) return Response.json({ error: "message_body_required" }, { status: 400 });
  if (!RECORD_TYPES.has(recordType)) return Response.json({ error: "unknown_communication_type" }, { status: 400 });
  if (!CHANNELS.has(channel)) return Response.json({ error: "unknown_communication_channel" }, { status: 400 });
  if (!AUDIENCES.has(audienceType)) return Response.json({ error: "unknown_communication_audience" }, { status: 400 });
  if (audienceType === "JOB" && !jobRef) return Response.json({ error: "job_audience_requires_canonical_job" }, { status: 400 });
  if (recordType === "VOICE_PROPOSAL" && channel !== "VOICE") return Response.json({ error: "voice_proposal_requires_voice_channel" }, { status: 400 });
  if (channel === "VOICE" && !requiresAcknowledgement) return Response.json({ error: "voice_requires_acknowledgement" }, { status: 400 });

  let job: { id: string; canonicalCode: string | null; title: string } | null = null;
  if (jobRef) {
    try {
      const rows = await getDb().select({ id: s04Records.id, canonicalCode: s04Records.canonicalCode, title: s04Records.title })
        .from(s04Records)
        .where(and(eq(s04Records.tenantId, context.tenantId), eq(s04Records.module, "operations"), or(eq(s04Records.id, jobRef), eq(s04Records.canonicalCode, jobRef))))
        .limit(1);
      job = rows[0] ?? null;
    } catch {
      return Response.json({ error: "communication_job_readback_unavailable" }, { status: 503 });
    }
    if (!job) return Response.json({ error: "job_not_found_in_tenant" }, { status: 404 });
  }

  const providerStatus = channel === "VOICE" ? "EXTERNAL_DEFERRED" : "SITES_READBACK_ONLY";
  const safePayload = {
    title,
    detail,
    body: detail,
    meta: `${channel} · ${audienceType}${job ? ` · ${job.canonicalCode ?? job.id}` : ""}`.slice(0, 140),
    status: channel === "VOICE" ? "EXTERNAL_DEFERRED" : "DRAFT",
    tone: channel === "VOICE" ? "amber" : "lime",
    progress: 0,
    recordType,
    channel,
    audienceType,
    audienceRef,
    jobId: job?.id ?? null,
    jobCode: job?.canonicalCode ?? null,
    jobTitle: job?.title ?? null,
    requiresAcknowledgement,
    deliveryStatus: "PENDING_EXTERNAL_CONSUMER",
    providerStatus,
    consentStatus: channel === "VOICE" ? "REQUIRED_BEFORE_CONNECTOR" : "NOT_APPLICABLE",
    directWrite: false,
    idempotencyKey: bounded(input.idempotencyKey, 160),
  };

  const forwardedRequest = new Request(request.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(safePayload),
  });
  return write(forwardedRequest, { params: Promise.resolve({ module: "communications" }) });
}
