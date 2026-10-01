import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { s04Records, s06Events, s06Outbox, s06Reconciliations } from "@/db/schema";
import {
  assertTenantScope,
  getAuthorityContext,
  hasCapability,
  publicAuthorityContext,
} from "@/lib/authority-context";
import {
  adapterError,
  recordForResponse,
  type S04Record,
} from "@/lib/s04-adapter";
import { allocateServerName, CanonicalCodeConflictError } from "@/lib/server-naming";
import {
  jobStatusLabel,
  normalizeJobStatus,
  type JobPayload,
} from "@/lib/operations-contract";

export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function safeText(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function validTone(value: unknown) {
  return value === "cyan" || value === "amber" || value === "red" ? value : "lime";
}

function validPriority(value: unknown): JobPayload["priority"] {
  return value === "HIGH" || value === "LOW" ? value : "STANDARD";
}

function boundedText(value: unknown, max: number, fallback = "") {
  return safeText(value, fallback).slice(0, max);
}

function operationEnvelope(context: NonNullable<Awaited<ReturnType<typeof getAuthorityContext>>>, rows: S04Record[]) {
  return {
    context: publicAuthorityContext(context),
    contract: {
      module: "operations",
      route: "/api/operations",
      source: "sites-d1-w03-operations",
      authority: "server-context",
      canonicalAdapter: "pending-external-domain-service",
      lifecycle: "bounded-commessa-write-readback",
      readback: "verified-at-request",
    },
    records: rows,
    readback: {
      status: "ok",
      count: rows.length,
      tenantId: context.tenantId,
      checkedAt: new Date().toISOString(),
    },
  };
}

export async function GET() {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "operations.read")) {
    return Response.json({ error: "forbidden", capability: "operations.read" }, { status: 403 });
  }

  try {
    const rows = await getDb()
      .select()
      .from(s04Records)
      .where(and(eq(s04Records.tenantId, context.tenantId), eq(s04Records.module, "operations")))
      .orderBy(desc(s04Records.updatedAt));
    return Response.json(operationEnvelope(context, rows.map(recordForResponse)), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return Response.json({ error: adapterError(error), module: "operations" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "operations.write")) {
    return Response.json({ error: "forbidden", capability: "operations.write" }, { status: 403 });
  }

  let input: Record<string, unknown>;
  try {
    const parsed = await request.json() as unknown;
    if (!isRecord(parsed)) return Response.json({ error: "invalid_json" }, { status: 400 });
    input = parsed;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const title = boundedText(input.title, 120);
  const description = boundedText(input.description ?? input.detail, 2_000);
  const client = boundedText(input.client, 160);
  const location = boundedText(input.location ?? input.detail, 240, "Ubicazione da definire");
  const category = boundedText(input.category, 80, "Operations");
  const dueDate = boundedText(input.dueDate ?? input.meta, 40, "Da pianificare");
  const priority = validPriority(input.priority);
  const statusCode = normalizeJobStatus(input.statusCode ?? input.status ?? "DRAFT");
  const openingType = boundedText(input.openingType, 80, "NUOVA_COMMESSA");
  const jobType = boundedText(input.jobType ?? input.category, 120, category);
  const specialization = boundedText(input.specialization, 120, "Da definire");
  const sourceMode = input.sourceMode === "COMPANY_AI" ? "COMPANY_AI" : "MANUAL";
  const aiPreviewId = boundedText(input.aiPreviewId, 120);
  const clientName = boundedText(input.clientName ?? input.client, 160, client);
  const clientTaxId = boundedText(input.clientTaxId, 80);
  const clientContact = boundedText(input.clientContact, 120);
  const clientPhone = boundedText(input.clientPhone, 80);
  const clientEmail = boundedText(input.clientEmail, 160);
  const clientReference = boundedText(input.clientReference, 160);
  const clientAddress = boundedText(input.clientAddress, 240);
  const worksite = boundedText(input.worksite ?? input.location ?? input.detail, 240, location);
  const accessNotes = boundedText(input.accessNotes, 2_000);
  const cig = boundedText(input.cig, 80);
  const cup = boundedText(input.cup, 80);
  const tone = validTone(input.tone);
  const requestedIdempotencyKey = boundedText(input.idempotencyKey, 160);

  if (title.length < 2) return Response.json({ error: "title_must_be_2_to_120_characters" }, { status: 400 });
  if (statusCode === "COMPLETED" || statusCode === "CLOSED") {
    return Response.json({ error: "new_job_must_start_before_completion" }, { status: 400 });
  }
  if (description.length > 2_000 || client.length > 160 || location.length > 240 || category.length > 80 || dueDate.length > 40 || openingType.length > 80 || jobType.length > 120 || specialization.length > 120 || accessNotes.length > 2_000) {
    return Response.json({ error: "field_length_exceeded" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const idempotencyKey = requestedIdempotencyKey || `operations:create:${crypto.randomUUID()}`;
  const correlationId = boundedText(input.correlationId, 120) || crypto.randomUUID();

  try {
    const db = getDb();
    const existing = await db
      .select()
      .from(s06Events)
      .where(and(eq(s06Events.tenantId, context.tenantId), eq(s06Events.idempotencyKey, idempotencyKey)))
      .limit(1);
    if (existing[0]) {
      const rows = await db.select().from(s04Records)
        .where(and(eq(s04Records.tenantId, context.tenantId), eq(s04Records.module, "operations")))
        .orderBy(desc(s04Records.updatedAt));
      return Response.json({ ...operationEnvelope(context, rows.map(recordForResponse)), idempotent: true, eventId: existing[0].eventId }, {
        headers: { "cache-control": "no-store" },
      });
    }

    assertTenantScope(context, context.tenantId);
    const naming = await allocateServerName({
      tenantId: context.tenantId,
      module: "operations",
      description: title,
    });
    if (!naming) return Response.json({ error: "canonical_code_unavailable" }, { status: 503 });

    const id = `OPERATIONS-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const eventId = crypto.randomUUID();
    const payload: JobPayload = {
      title,
      description,
      client,
      clientName,
      clientTaxId,
      clientContact,
      clientPhone,
      clientEmail,
      clientReference,
      clientAddress,
      location,
      worksite,
      accessNotes,
      cig,
      cup,
      category,
      openingType,
      jobType,
      specialization,
      priority,
      dueDate,
      statusCode,
      sourceMode,
      aiPreviewId: aiPreviewId || null,
      version: 1,
      activities: [],
      evidence: [],
      assignment: null,
      source: sourceMode === "COMPANY_AI" ? "company-ai-proposal-confirmed" : "manual-intake",
      createdAt: now,
      naming,
    };
    const serializedPayload = JSON.stringify(payload);
    const eventPayload = JSON.stringify({
      action: "create",
      aggregate: "commessa",
      canonicalCode: naming.canonicalCode,
      title,
      statusCode,
      sourceMode,
      version: 1,
      source: sourceMode === "COMPANY_AI" ? "company-ai-proposal-confirmed" : "manual-intake",
    });

    await db.batch([
      db.insert(s04Records).values({
        id,
        tenantId: context.tenantId,
        module: "operations",
        canonicalCode: naming.canonicalCode,
        recordType: "job",
        title: naming.canonicalCode,
        detail: worksite,
        meta: dueDate,
        status: jobStatusLabel(statusCode),
        tone,
        progress: 0,
        payloadJson: serializedPayload,
        createdBy: context.actorId,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(s06Events).values({
        eventId,
        tenantId: context.tenantId,
        eventType: "operations.job.created",
        schemaVersion: "1",
        actorType: "human",
        actorId: context.actorId,
        source: "sites-command",
        occurredAt: now,
        observedAt: now,
        aggregateType: "commessa",
        aggregateId: naming.canonicalCode,
        aggregateVersion: 1,
        payloadJson: eventPayload,
        correlationId,
        causationId: null,
        idempotencyKey,
        status: "COMMITTED_SITES_READBACK",
        createdAt: now,
      }),
      db.insert(s06Outbox).values({
        id: crypto.randomUUID(),
        tenantId: context.tenantId,
        eventId,
        topic: "zerow.operations.job.created",
        status: "PENDING_EXTERNAL_CONSUMER",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(s06Reconciliations).values({
        id: crypto.randomUUID(),
        tenantId: context.tenantId,
        aggregateType: "commessa",
        aggregateId: naming.canonicalCode,
        expectedVersion: 1,
        observedVersion: 1,
        status: "SITES_READBACK_VERIFIED",
        detail: "Creazione commessa persistita su D1; consumer canonico esterno ancora differito.",
        createdAt: now,
        updatedAt: now,
      }),
    ]);

    const rows = await db.select().from(s04Records)
      .where(and(eq(s04Records.tenantId, context.tenantId), eq(s04Records.module, "operations")))
      .orderBy(desc(s04Records.updatedAt));
    const created = rows.find((row) => row.id === id);
    return Response.json({
      ...operationEnvelope(context, rows.map(recordForResponse)),
      created: created ? recordForResponse(created) : null,
      event: { eventId, aggregateId: naming.canonicalCode, aggregateVersion: 1, readback: "verified" },
      idempotent: false,
    }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof CanonicalCodeConflictError) {
      return Response.json({ error: error.code }, { status: 409 });
    }
    return Response.json({ error: adapterError(error), module: "operations" }, { status: 503 });
  }
}
