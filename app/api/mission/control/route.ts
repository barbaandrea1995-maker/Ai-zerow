import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { jobJourneyRecords, s04Records, s06Events, s06Outbox, s06Reconciliations } from "@/db/schema";
import { getAuthorityContext, hasCapability, publicAuthorityContext } from "@/lib/authority-context";
import { assertMissionResourceSelection, MissionResourceError } from "@/lib/mission-resources";
import { parseJobPayload } from "@/lib/operations-contract";
import { allocateServerName } from "@/lib/server-naming";

export const dynamic = "force-dynamic";

function parseJson(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

function boundedText(value: unknown, max: number, fallback = "") {
  return typeof value === "string" ? value.trim().slice(0, max) : fallback;
}

function validDateTime(value: string) {
  return value.length >= 10 && Number.isFinite(Date.parse(value));
}

function missionResponse(row: typeof jobJourneyRecords.$inferSelect, job: typeof s04Records.$inferSelect | null, idempotent: boolean) {
  return {
    context: null,
    jobId: row.jobId,
    missionId: row.id,
    record: {
      id: row.id,
      jobId: row.jobId,
      title: row.title,
      status: row.status,
      version: row.version,
      payload: parseJson(row.payloadJson),
    },
    job: job ? {
      id: job.id,
      code: job.canonicalCode,
      title: parseJobPayload(job.payloadJson).title || job.title,
      module: job.module,
    } : null,
    idempotent,
  };
}

export async function GET() {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "mission.read")) {
    return Response.json({ error: "forbidden", capability: "mission.read" }, { status: 403 });
  }
  try {
    const db = getDb();
    const [missions, operationJobs] = await Promise.all([
      db.select().from(jobJourneyRecords).where(and(
        eq(jobJourneyRecords.tenantId, context.tenantId),
        eq(jobJourneyRecords.domain, "mission"),
      )).orderBy(desc(jobJourneyRecords.updatedAt)).limit(500),
      db.select().from(s04Records).where(and(
        eq(s04Records.tenantId, context.tenantId),
        eq(s04Records.module, "operations"),
      )).orderBy(desc(s04Records.updatedAt)).limit(500),
    ]);
    const jobIds = [...new Set(missions.map((mission) => mission.jobId))];
    const jobs = jobIds.length ? await db.select().from(s04Records).where(and(
      eq(s04Records.tenantId, context.tenantId),
      inArray(s04Records.module, ["operations", "mission"]),
      inArray(s04Records.id, jobIds),
    )) : [];
    const jobById = new Map(jobs.map((job) => [job.id, job]));
    const records = missions.map((mission) => {
      const job = jobById.get(mission.jobId);
      const jobPayload = job ? parseJobPayload(job.payloadJson) : null;
      return {
        id: mission.id,
        jobId: mission.jobId,
        jobCode: job?.canonicalCode ?? null,
        jobTitle: jobPayload?.title ?? (job?.module === "mission" ? "Trasporto autonomo" : "Commessa"),
        jobModule: job?.module ?? "mission",
        title: mission.title,
        status: mission.status,
        version: mission.version,
        payload: parseJson(mission.payloadJson),
        createdAt: mission.createdAt,
        updatedAt: mission.updatedAt,
      };
    });
    const jobView = (job: typeof s04Records.$inferSelect) => {
      const jobPayload = parseJobPayload(job.payloadJson);
      return {
        id: job.id,
        code: job.canonicalCode,
        title: jobPayload?.title || job.title,
        client: jobPayload?.clientName || jobPayload?.client || null,
        location: jobPayload?.worksite || jobPayload?.location || null,
        status: jobPayload?.statusCode || job.status,
      };
    };

    return Response.json({
      context: publicAuthorityContext(context),
      jobs: operationJobs.filter((job) => job.recordType !== "adapter-contract").map(jobView),
      missions: records,
      summary: {
        total: records.length,
        planned: records.filter((record) => record.status === "PLANNED").length,
        dispatched: records.filter((record) => record.status === "DISPATCHED").length,
        delivered: records.filter((record) => record.status === "DELIVERED").length,
      },
    }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return Response.json({ error: "mission_control_unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "mission.write")) {
    return Response.json({ error: "forbidden", capability: "mission.write" }, { status: 403 });
  }
  if (!hasCapability(context, "workforce.registry.read") || !hasCapability(context, "asset.read")) {
    return Response.json({ error: "mission_resource_registry_access_required" }, { status: 403 });
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > 65_536) return Response.json({ error: "payload_too_large" }, { status: 413 });

  let input: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 65_536) return Response.json({ error: "payload_too_large" }, { status: 413 });
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return Response.json({ error: "invalid_json" }, { status: 400 });
    input = parsed as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  if (boundedText(input.action, 40) !== "mission_create") return Response.json({ error: "unsupported_mission_action" }, { status: 400 });
  const idempotencyKey = boundedText(input.idempotencyKey, 160);
  const title = boundedText(input.title, 160, "Missione di trasporto");
  const pickup = boundedText(input.pickup, 240);
  const dropoff = boundedText(input.dropoff, 240);
  const plannedAt = boundedText(input.plannedAt, 40);
  const plannedEndAt = boundedText(input.plannedEndAt, 40);
  const driverId = boundedText(input.driverId, 120);
  const vehicleId = boundedText(input.vehicleId, 120);
  const cargoAssetId = boundedText(input.cargoAssetId, 120);
  if (!idempotencyKey) return Response.json({ error: "idempotency_key_required" }, { status: 400 });
  if (!pickup || !dropoff || !validDateTime(plannedAt)) return Response.json({ error: "mission_route_and_valid_date_required" }, { status: 400 });
  if (!driverId || !vehicleId) return Response.json({ error: "mission_driver_and_vehicle_required" }, { status: 400 });
  if (Object.prototype.hasOwnProperty.call(input, "driver") || Object.prototype.hasOwnProperty.call(input, "vehicle")) {
    return Response.json({ error: "mission_free_text_resources_not_allowed" }, { status: 400 });
  }

  try {
    const resources = await assertMissionResourceSelection({
      tenantId: context.tenantId,
      driverId,
      vehicleId,
      cargoAssetId: cargoAssetId || undefined,
      plannedAt,
      plannedEndAt: plannedEndAt || undefined,
    });
    const db = getDb();
    const [existingEvent] = await db.select().from(s06Events).where(and(
      eq(s06Events.tenantId, context.tenantId),
      eq(s06Events.idempotencyKey, idempotencyKey),
    )).limit(1);
    if (existingEvent) {
      if (existingEvent.aggregateType !== "job.journey.mission") return Response.json({ error: "mission_idempotency_key_conflict" }, { status: 409 });
      const [existingRecord] = await db.select().from(jobJourneyRecords).where(and(
        eq(jobJourneyRecords.tenantId, context.tenantId),
        eq(jobJourneyRecords.id, existingEvent.aggregateId),
      )).limit(1);
      if (!existingRecord) return Response.json({ error: "mission_readback_unavailable" }, { status: 503 });
      const [existingJob] = await db.select().from(s04Records).where(and(
        eq(s04Records.tenantId, context.tenantId),
        eq(s04Records.id, existingRecord.jobId),
        eq(s04Records.module, "mission"),
      )).limit(1);
      if (!existingJob) return Response.json({ error: "mission_idempotency_key_conflict" }, { status: 409 });
      return Response.json({ ...missionResponse(existingRecord, existingJob ?? null, true), context: publicAuthorityContext(context) }, { headers: { "cache-control": "private, no-store" } });
    }

    const now = new Date().toISOString();
    const jobId = crypto.randomUUID();
    const missionId = crypto.randomUUID();
    const eventId = crypto.randomUUID();
    const naming = await allocateServerName({ tenantId: context.tenantId, module: "mission", description: title });
    const jobPayload = {
      title,
      description: `Trasporto autonomo: ${pickup} → ${dropoff}`,
      client: "",
      location: pickup,
      category: "TRASPORTO",
      priority: "STANDARD",
      dueDate: resources.window.endsAt,
      statusCode: "PLANNED",
      version: 1,
      workItems: [],
      progress: 0,
      activities: [],
      evidence: [],
      assignment: null,
      source: "mission-standalone",
    };
    const payload = {
      pickup,
      dropoff,
      plannedAt: resources.window.startsAt,
      plannedEndAt: resources.window.endsAt,
      driverId: resources.driver.id,
      vehicleId: resources.vehicle.id,
      cargoAssetId: resources.cargoAsset?.id ?? null,
      resourceSnapshot: {
        driver: { id: resources.driver.id, code: resources.driver.code, label: resources.driver.label },
        vehicle: { id: resources.vehicle.id, code: resources.vehicle.code, label: resources.vehicle.label },
        cargoAsset: resources.cargoAsset
          ? { id: resources.cargoAsset.id, code: resources.cargoAsset.code, label: resources.cargoAsset.label }
          : null,
      },
      notes: boundedText(input.notes, 2_000),
      standalone: true,
    };

    const results = await db.batch([
      db.insert(s04Records).values({
        id: jobId,
        tenantId: context.tenantId,
        module: "mission",
        canonicalCode: naming?.canonicalCode ?? null,
        recordType: "transport-job",
        title,
        detail: `Trasporto autonomo · ${pickup} → ${dropoff}`,
        meta: "MISSION / STANDALONE",
        status: "PLANNED",
        tone: "lime",
        progress: 0,
        payloadJson: JSON.stringify(jobPayload),
        createdBy: context.actorId,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(jobJourneyRecords).values({
        id: missionId,
        tenantId: context.tenantId,
        jobId,
        domain: "mission",
        recordType: "TRANSPORT",
        title,
        status: "PLANNED",
        version: 1,
        payloadJson: JSON.stringify(payload),
        idempotencyKey,
        createdBy: context.actorId,
        updatedBy: context.actorId,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(s06Events).values({
        eventId,
        tenantId: context.tenantId,
        eventType: "mission.transport.created",
        schemaVersion: "1",
        actorType: "human",
        actorId: context.actorId,
        source: "sites-mission-control",
        occurredAt: now,
        observedAt: now,
        aggregateType: "job.journey.mission",
        aggregateId: missionId,
        aggregateVersion: 1,
        payloadJson: JSON.stringify({ action: "mission_create", jobId, domain: "mission", recordType: "TRANSPORT", recordId: missionId, status: "PLANNED", version: 1, standalone: true }),
        correlationId: crypto.randomUUID(),
        causationId: null,
        idempotencyKey,
        status: "COMMITTED_SITES_READBACK",
        createdAt: now,
      }),
      db.insert(s06Outbox).values({ id: crypto.randomUUID(), tenantId: context.tenantId, eventId, topic: "zerow.mission.transport.created", status: "PENDING_EXTERNAL_CONSUMER", attempts: 0, createdAt: now, updatedAt: now }),
      db.insert(s06Reconciliations).values({ id: crypto.randomUUID(), tenantId: context.tenantId, aggregateType: "job.journey.mission", aggregateId: missionId, expectedVersion: 1, observedVersion: 1, status: "SITES_READBACK_VERIFIED", detail: "Missione autonoma persistita con risorse reali, finestra temporale e readback D1.", createdAt: now, updatedAt: now }),
    ]);
    if (!results[0] || !results[1]) return Response.json({ error: "mission_readback_unavailable" }, { status: 503 });
    const [createdJob] = await db.select().from(s04Records).where(and(eq(s04Records.tenantId, context.tenantId), eq(s04Records.id, jobId))).limit(1);
    const [createdRecord] = await db.select().from(jobJourneyRecords).where(and(eq(jobJourneyRecords.tenantId, context.tenantId), eq(jobJourneyRecords.id, missionId))).limit(1);
    if (!createdRecord) return Response.json({ error: "mission_readback_unavailable" }, { status: 503 });
    return Response.json({ ...missionResponse(createdRecord, createdJob ?? null, false), context: publicAuthorityContext(context), eventId }, { status: 201, headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof MissionResourceError) {
      return Response.json({ error: error.code, details: error.details ?? null }, { status: error.code === "mission_resource_conflict" ? 409 : 400 });
    }
    const message = error instanceof Error ? error.message : "";
    if (/unique|constraint/i.test(message)) return Response.json({ error: "mission_idempotency_or_code_conflict" }, { status: 409 });
    return Response.json({ error: "mission_create_unavailable" }, { status: 503 });
  }
}
