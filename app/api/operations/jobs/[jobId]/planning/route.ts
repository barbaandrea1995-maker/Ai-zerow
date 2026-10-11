import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { jobJourneyRecords, s04Records, s06Events, s06Outbox, s06Reconciliations } from "@/db/schema";
import { getAuthorityContext, hasCapability, publicAuthorityContext } from "@/lib/authority-context";
import {
  planningActivityType,
  planningPriority,
  planningResourceProfile,
  type PlanningActivityType,
} from "@/lib/planning-catalog";
import {
  evaluatePlanning,
  normalizePlanningResource,
  normalizePlanningSlot,
  planningStatus,
  type PlanningResource,
  type PlanningSlot,
} from "@/lib/planning-contract";
import { PlanningResourceError, resolvePlanningResources } from "@/lib/planning-resources";
import { canReadAllOperations, rowMatchesContext, teamScopeTokens } from "@/lib/operational-scope";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ jobId: string }> };
type JsonObject = Record<string, unknown>;
const NON_PLANNABLE_JOB_STATUSES = new Set(["COMPLETED", "CLOSED", "CANCELLED"]);

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function bounded(value: unknown, max: number, fallback = "") {
  return typeof value === "string" ? value.trim().slice(0, max) : fallback;
}

function parseJson(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function readBoundedJson(request: Request, maxBytes = 96_000) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) return { error: "payload_too_large" as const };
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) return { error: "payload_too_large" as const };
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? { value: parsed } : { error: "invalid_json" as const };
  } catch {
    return { error: "invalid_json" as const };
  }
}

async function routeJobId(routeContext: RouteContext) {
  try {
    const value = decodeURIComponent((await routeContext.params).jobId).trim();
    return value && value.length <= 160 ? value : null;
  } catch {
    return null;
  }
}

async function findJob(tenantId: string, reference: string) {
  const base = and(eq(s04Records.tenantId, tenantId), inArray(s04Records.module, ["operations", "mission"]));
  const [byId] = await getDb().select().from(s04Records).where(and(base, eq(s04Records.id, reference))).limit(1);
  if (byId) return byId;
  const [byCode] = await getDb().select().from(s04Records).where(and(base, eq(s04Records.canonicalCode, reference))).limit(1);
  return byCode ?? null;
}

async function canAccessJob(context: NonNullable<Awaited<ReturnType<typeof getAuthorityContext>>>, job: typeof s04Records.$inferSelect) {
  if (canReadAllOperations(context)) return true;
  const workforceRows = await getDb().select().from(s04Records).where(and(
    eq(s04Records.tenantId, context.tenantId),
    eq(s04Records.module, "workforce"),
  )).limit(500);
  return rowMatchesContext(job, context, teamScopeTokens(workforceRows, context));
}

function recordForResponse(row: typeof jobJourneyRecords.$inferSelect) {
  return {
    id: row.id,
    jobId: row.jobId,
    domain: row.domain,
    recordType: row.recordType,
    title: row.title,
    status: row.status,
    version: row.version,
    payload: parseJson(row.payloadJson),
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function planningData(row: typeof jobJourneyRecords.$inferSelect) {
  const payload = parseJson(row.payloadJson);
  const resources = Array.isArray(payload.resources)
    ? payload.resources.map(normalizePlanningResource).filter((item): item is PlanningResource => Boolean(item))
    : [];
  const slots = Array.isArray(payload.slots)
    ? payload.slots.map(normalizePlanningSlot).filter((item): item is PlanningSlot => Boolean(item))
    : [];
  return { payload, resources, slots };
}

async function activeTenantPlans(tenantId: string, excludedId?: string) {
  const rows = await getDb().select().from(jobJourneyRecords).where(and(
    eq(jobJourneyRecords.tenantId, tenantId),
    eq(jobJourneyRecords.domain, "planning"),
    eq(jobJourneyRecords.status, "PUBLISHED"),
  )).orderBy(desc(jobJourneyRecords.updatedAt)).limit(500);
  return rows.filter((row) => row.id !== excludedId);
}

function evaluateAgainstTenant(
  candidateSlots: PlanningSlot[],
  candidateResources: PlanningResource[],
  existing: (typeof jobJourneyRecords.$inferSelect)[],
) {
  const slots = [...candidateSlots];
  const resources = [...candidateResources];
  const resourcesById = new Map(resources.map((resource) => [resource.id, resource]));
  for (const row of existing) {
    const data = planningData(row);
    for (const resource of data.resources) {
      const current = resourcesById.get(resource.id);
      if (!current) {
        resources.push(resource);
        resourcesById.set(resource.id, resource);
      } else if (resource.capacity > current.capacity) {
        current.capacity = resource.capacity;
      }
    }
    slots.push(...data.slots.map((slot) => ({ ...slot, id: `${row.id}:${slot.id}` })));
  }
  return evaluatePlanning(slots, resources);
}

function planPayload(
  input: JsonObject,
  now: string,
  canonical: {
    activityType: PlanningActivityType;
    location: string;
    scopeSubgroupId: string;
    scopeSubgroupTitle: string;
  },
): JsonObject | null {
  const rawResources = Array.isArray(input.resources) ? input.resources : [];
  const resources = rawResources.map(normalizePlanningResource).filter((item): item is PlanningResource => Boolean(item)).slice(0, 64);
  const rawSlots = Array.isArray(input.slots) ? input.slots : [];
  const slots = rawSlots.map(normalizePlanningSlot).filter((item): item is PlanningSlot => Boolean(item)).slice(0, 128);
  if (!slots.length) {
    const fallback = normalizePlanningSlot({
      id: "slot-1",
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      resourceIds: input.resourceIds,
      requiredQualifications: input.requiredQualifications,
      workload: input.workload,
    });
    if (fallback) slots.push(fallback);
  }
  if (!resources.length || !slots.length) return null;
  const priority = planningPriority(input.priority);
  if (!priority) return null;
  return {
    activityType: canonical.activityType,
    scopeSubgroupId: canonical.scopeSubgroupId,
    scopeSubgroupTitle: canonical.scopeSubgroupTitle,
    location: canonical.location,
    priority,
    startsAt: bounded(input.startsAt, 40, slots[0].startsAt),
    endsAt: bounded(input.endsAt, 40, slots[0].endsAt),
    selectedResourceIds: [...new Set(slots.flatMap((slot) => slot.resourceIds))].slice(0, 64),
    resources,
    slots,
    notes: bounded(input.notes, 2_000),
    mode: "EXECUTABLE",
    createdAt: now,
  };
}

function planningCompositionError(resources: PlanningResource[], activityType: PlanningActivityType) {
  const people = resources.filter((resource) => resource.kind === "person");
  const teams = resources.filter((resource) => resource.kind === "team");
  const vehicles = resources.filter((resource) => resource.kind === "vehicle");
  if (activityType === "TRANSPORT") {
    if (!people.length) return "Seleziona almeno un autista di consegna dal registro Persone.";
    if (!vehicles.length) return "Seleziona un mezzo di trasporto disponibile o un autista con mezzo affidato.";
    return null;
  }
  return people.length || teams.length ? null : "Seleziona almeno una persona o una squadra operativa.";
}

async function appendPlanMutation({
  tenantId,
  actorId,
  jobId,
  title,
  status,
  payload,
  idempotencyKey,
  eventType,
  now,
}: {
  tenantId: string;
  actorId: string;
  jobId: string;
  title: string;
  status: string;
  payload: JsonObject;
  idempotencyKey: string;
  eventType: string;
  now: string;
}) {
  const db = getDb();
  const id = crypto.randomUUID();
  const eventId = crypto.randomUUID();
  await db.batch([
    db.insert(jobJourneyRecords).values({
      id,
      tenantId,
      jobId,
      domain: "planning",
      recordType: "PLAN",
      title,
      status,
      version: 1,
      payloadJson: JSON.stringify(payload),
      idempotencyKey,
      createdBy: actorId,
      updatedBy: actorId,
      createdAt: now,
      updatedAt: now,
    }),
    db.insert(s06Events).values({
      eventId,
      tenantId,
      eventType,
      schemaVersion: "1",
      actorType: "human",
      actorId,
      source: "sites-planning",
      occurredAt: now,
      observedAt: now,
      aggregateType: "job.journey.planning",
      aggregateId: id,
      aggregateVersion: 1,
      payloadJson: JSON.stringify({ jobId, status, source: "sites-planning" }),
      correlationId: crypto.randomUUID(),
      causationId: null,
      idempotencyKey,
      status: "COMMITTED_SITES_READBACK",
      createdAt: now,
    }),
    db.insert(s06Outbox).values({
      id: crypto.randomUUID(),
      tenantId,
      eventId,
      topic: `zerow.${eventType}`,
      status: "PENDING_EXTERNAL_CONSUMER",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    }),
    db.insert(s06Reconciliations).values({
      id: crypto.randomUUID(),
      tenantId,
      aggregateType: "job.journey.planning",
      aggregateId: id,
      expectedVersion: 1,
      observedVersion: 1,
      status: "SITES_READBACK_VERIFIED",
      detail: "Piano persistito con valutazione di capacità, conflitti e revisionabilità.",
      createdAt: now,
      updatedAt: now,
    }),
  ]);
  const [row] = await db.select().from(jobJourneyRecords).where(and(
    eq(jobJourneyRecords.tenantId, tenantId),
    eq(jobJourneyRecords.id, id),
  )).limit(1);
  return { row: row ?? null, eventId };
}

export async function GET(_request: Request, routeContext: RouteContext) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "planning.read")) return Response.json({ error: "forbidden", capability: "planning.read" }, { status: 403 });
  const reference = await routeJobId(routeContext);
  if (!reference) return Response.json({ error: "invalid_job_id" }, { status: 400 });
  try {
    const job = await findJob(context.tenantId, reference);
    if (!job) return Response.json({ error: "job_not_found" }, { status: 404 });
    if (!(await canAccessJob(context, job))) return Response.json({ error: "job_not_found" }, { status: 404 });
    const rows = await getDb().select().from(jobJourneyRecords).where(and(
      eq(jobJourneyRecords.tenantId, context.tenantId),
      eq(jobJourneyRecords.jobId, job.id),
      eq(jobJourneyRecords.domain, "planning"),
    )).orderBy(desc(jobJourneyRecords.updatedAt)).limit(200);
    return Response.json({
      context: publicAuthorityContext(context),
      contract: {
        source: "sites-d1-planning-advanced",
        capabilities: ["capacity", "conflicts", "qualifications", "revision", "what_if"],
        externalExecutor: "deferred",
      },
      plans: rows.map((row) => ({ ...recordForResponse(row), evaluation: evaluatePlanning(planningData(row).slots, planningData(row).resources) })),
      readback: { status: "verified", scope: "tenant", checkedAt: new Date().toISOString() },
    }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return Response.json({ error: "planning_readback_unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request, routeContext: RouteContext) {
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, "planning.write")) return Response.json({ error: "forbidden", capability: "planning.write" }, { status: 403 });
  const reference = await routeJobId(routeContext);
  if (!reference) return Response.json({ error: "invalid_job_id" }, { status: 400 });
  const parsed = await readBoundedJson(request);
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: parsed.error === "payload_too_large" ? 413 : 400 });
  const input = parsed.value;
  const action = bounded(input.action, 24, "draft").toLowerCase();
  const idempotencyKey = bounded(input.idempotencyKey, 160);
  if (idempotencyKey.length < 8) return Response.json({ error: "idempotency_key_required" }, { status: 400 });

  try {
    const db = getDb();
    const job = await findJob(context.tenantId, reference);
    if (!job) return Response.json({ error: "job_not_found" }, { status: 404 });
    if (!(await canAccessJob(context, job))) return Response.json({ error: "job_not_found" }, { status: 404 });
    if (job.recordType === "adapter-contract") return Response.json({ error: "operational_job_required" }, { status: 409 });
    const jobPayload = parseJson(job.payloadJson);
    const jobStatus = bounded(jobPayload.statusCode, 32, job.status).toUpperCase();
    const jobModule = job.module === "mission" ? "mission" : "operations";
    const jobScope = isRecord(jobPayload.scope) ? jobPayload.scope : {};
    const canonicalLocation = bounded(jobPayload.worksite ?? jobPayload.location ?? job.detail, 240);
    const canonicalScope = {
      scopeSubgroupId: bounded(jobPayload.scopeSubgroupId ?? jobScope.subgroupId, 160),
      scopeSubgroupTitle: bounded(jobScope.subgroupTitle, 240),
    };
    const [existingEvent] = await db.select().from(s06Events).where(and(
      eq(s06Events.tenantId, context.tenantId),
      eq(s06Events.idempotencyKey, idempotencyKey),
    )).limit(1);
    if (existingEvent) {
      if (existingEvent.aggregateType !== "job.journey.planning") {
        return Response.json({ error: "planning_idempotency_key_conflict" }, { status: 409 });
      }
      const [record] = await db.select().from(jobJourneyRecords).where(and(
        eq(jobJourneyRecords.tenantId, context.tenantId),
        eq(jobJourneyRecords.id, existingEvent.aggregateId),
        eq(jobJourneyRecords.jobId, job.id),
      )).limit(1);
      if (!record) return Response.json({ error: "planning_idempotency_readback_unavailable" }, { status: 503 });
      return Response.json({ plan: recordForResponse(record), idempotent: true, eventId: existingEvent.eventId, readback: { status: "verified", scope: "tenant", version: record.version } }, { headers: { "cache-control": "private, no-store" } });
    }
    if (NON_PLANNABLE_JOB_STATUSES.has(jobStatus) && action !== "cancel") {
      return Response.json({ error: "planning_job_not_active", status: jobStatus }, { status: 409 });
    }
    if (!canonicalLocation && action !== "cancel") return Response.json({ error: "planning_job_location_required" }, { status: 409 });

    const now = new Date().toISOString();
    if (action === "what_if" || action === "draft" || action === "revise") {
      const activityType = planningActivityType(input.activityType, jobModule);
      if (!activityType) return Response.json({ error: "invalid_planning_activity_type" }, { status: 400 });
      if (!planningPriority(input.priority)) return Response.json({ error: "invalid_planning_priority" }, { status: 400 });
      const resourceWindow = (() => {
        const startsAt = bounded(input.startsAt, 40);
        const endsAt = bounded(input.endsAt, 40);
        return startsAt && endsAt && Number.isFinite(Date.parse(startsAt)) && Number.isFinite(Date.parse(endsAt)) && Date.parse(endsAt) > Date.parse(startsAt)
          ? { startsAt, endsAt }
          : undefined;
      })();
      let canonicalResources: PlanningResource[];
      try {
        canonicalResources = await resolvePlanningResources(
          context.tenantId,
          input.resourceIds,
          resourceWindow,
          planningResourceProfile(activityType),
          action === "revise" ? bounded(input.recordId, 120) : undefined,
        );
      } catch (error) {
        if (error instanceof PlanningResourceError) {
          return Response.json({ error: error.code, detail: error.message }, { status: error.code === "planning_resource_unavailable" ? 409 : 400 });
        }
        throw error;
      }
      if (canonicalResources.some((resource) => resource.kind === "person" || resource.kind === "team")
        && !hasCapability(context, "workforce.registry.read")
        && !hasCapability(context, "workforce.read.all")) {
        return Response.json({ error: "workforce_registry_access_required" }, { status: 403 });
      }
      if (canonicalResources.some((resource) => resource.kind === "asset" || resource.kind === "vehicle")
        && !hasCapability(context, "asset.read")) {
        return Response.json({ error: "asset_registry_access_required" }, { status: 403 });
      }
      const compositionError = planningCompositionError(canonicalResources, activityType);
      if (compositionError) return Response.json({ error: "planning_resource_composition_invalid", detail: compositionError }, { status: 400 });
      const payload = planPayload({
        ...input,
        resources: canonicalResources,
      }, now, {
        activityType,
        location: canonicalLocation,
        ...canonicalScope,
      });
      if (!payload) return Response.json({ error: "valid_resources_and_slots_required" }, { status: 400 });
      const existing = await activeTenantPlans(context.tenantId, action === "revise" ? bounded(input.recordId, 120) : undefined);
      const evaluation = evaluateAgainstTenant(payload.slots as PlanningSlot[], payload.resources as PlanningResource[], existing);
      if (action === "what_if") {
        return Response.json({
          persisted: false,
          status: planningStatus(evaluation),
          evaluation,
          candidate: payload,
          readback: { status: "simulation_only", scope: "tenant", checkedAt: now },
        }, { headers: { "cache-control": "private, no-store" } });
      }
      if (!evaluation.feasible) {
        return Response.json({ error: "planning_conflicts", status: "CONFLICTED", evaluation }, { status: 409 });
      }
      if (action === "revise") {
        const recordId = bounded(input.recordId, 120);
        const expectedVersion = typeof input.expectedVersion === "number" ? Math.floor(input.expectedVersion) : null;
        if (!recordId || expectedVersion === null || expectedVersion < 1) return Response.json({ error: "record_id_and_expected_version_required" }, { status: 400 });
        const [source] = await db.select().from(jobJourneyRecords).where(and(
          eq(jobJourneyRecords.tenantId, context.tenantId),
          eq(jobJourneyRecords.jobId, job.id),
          eq(jobJourneyRecords.id, recordId),
          eq(jobJourneyRecords.domain, "planning"),
        )).limit(1);
        if (!source) return Response.json({ error: "planning_record_not_found" }, { status: 404 });
        if (source.version !== expectedVersion) return Response.json({ error: "version_conflict", expectedVersion, currentVersion: source.version }, { status: 409 });
        if (source.status !== "DRAFT") return Response.json({ error: "planning_revision_requires_draft", status: source.status }, { status: 409 });
        const nextVersion = source.version + 1;
        const eventId = crypto.randomUUID();
        payload.revisionOf = source.id;
        payload.revisionNumber = source.version + 1;
        payload.evaluation = evaluation;
        payload.status = "DRAFT";
        payload.revisedAt = now;
        payload.revisedBy = context.actorId;
        const results = await db.batch([
          db.update(jobJourneyRecords).set({
            title: bounded(input.title, 160, source.title),
            status: "DRAFT",
            version: nextVersion,
            payloadJson: JSON.stringify(payload),
            updatedBy: context.actorId,
            updatedAt: now,
          }).where(and(
            eq(jobJourneyRecords.tenantId, context.tenantId),
            eq(jobJourneyRecords.id, source.id),
            eq(jobJourneyRecords.version, expectedVersion),
          )).returning(),
          db.insert(s06Events).values({
            eventId,
            tenantId: context.tenantId,
            eventType: "planning.plan.revised",
            schemaVersion: "1",
            actorType: "human",
            actorId: context.actorId,
            source: "sites-planning",
            occurredAt: now,
            observedAt: now,
            aggregateType: "job.journey.planning",
            aggregateId: source.id,
            aggregateVersion: nextVersion,
            payloadJson: JSON.stringify({ jobId: job.id, status: "DRAFT", source: "sites-planning" }),
            correlationId: crypto.randomUUID(),
            causationId: null,
            idempotencyKey,
            status: "COMMITTED_SITES_READBACK",
            createdAt: now,
          }),
          db.insert(s06Outbox).values({ id: crypto.randomUUID(), tenantId: context.tenantId, eventId, topic: "zerow.planning.plan.revised", status: "PENDING_EXTERNAL_CONSUMER", attempts: 0, createdAt: now, updatedAt: now }),
          db.insert(s06Reconciliations).values({ id: crypto.randomUUID(), tenantId: context.tenantId, aggregateType: "job.journey.planning", aggregateId: source.id, expectedVersion: nextVersion, observedVersion: nextVersion, status: "SITES_READBACK_VERIFIED", detail: "Bozza aggiornata con cataloghi canonici e nuova verifica di disponibilità.", createdAt: now, updatedAt: now }),
        ]);
        const updated = (results[0] as (typeof jobJourneyRecords.$inferSelect)[])[0];
        if (!updated) return Response.json({ error: "version_conflict", currentVersion: source.version }, { status: 409 });
        return Response.json({ plan: recordForResponse(updated), evaluation, eventId, idempotent: false, readback: { status: "verified", scope: "tenant", version: updated.version } }, { headers: { "cache-control": "private, no-store" } });
      }
      payload.evaluation = evaluation;
      payload.status = "DRAFT";
      const result = await appendPlanMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        jobId: job.id,
        title: bounded(input.title, 160, "Piano operativo"),
        status: "DRAFT",
        payload,
        idempotencyKey,
        eventType: "planning.plan.created",
        now,
      });
      if (!result.row) return Response.json({ error: "planning_readback_unavailable" }, { status: 503 });
      return Response.json({ plan: recordForResponse(result.row), evaluation, eventId: result.eventId, idempotent: false, readback: { status: "verified", scope: "tenant", version: result.row.version } }, { status: 201, headers: { "cache-control": "private, no-store" } });
    }

    if (action !== "publish" && action !== "cancel") return Response.json({ error: "unsupported_planning_action", allowed: ["draft", "publish", "revise", "what_if", "cancel"] }, { status: 400 });
    const recordId = bounded(input.recordId, 120);
    const expectedVersion = typeof input.expectedVersion === "number" ? Math.floor(input.expectedVersion) : null;
    if (!recordId || expectedVersion === null || expectedVersion < 1) return Response.json({ error: "record_id_and_expected_version_required" }, { status: 400 });
    const [record] = await db.select().from(jobJourneyRecords).where(and(
      eq(jobJourneyRecords.tenantId, context.tenantId),
      eq(jobJourneyRecords.jobId, job.id),
      eq(jobJourneyRecords.id, recordId),
      eq(jobJourneyRecords.domain, "planning"),
    )).limit(1);
    if (!record) return Response.json({ error: "planning_record_not_found" }, { status: 404 });
    if (record.version !== expectedVersion) return Response.json({ error: "version_conflict", expectedVersion, currentVersion: record.version }, { status: 409 });
    if (action === "cancel") {
      if (record.status !== "DRAFT" && record.status !== "PUBLISHED") return Response.json({ error: "invalid_planning_transition", status: record.status }, { status: 409 });
      const linkedMissionRows = await db.select().from(jobJourneyRecords).where(and(
        eq(jobJourneyRecords.tenantId, context.tenantId),
        eq(jobJourneyRecords.jobId, job.id),
        eq(jobJourneyRecords.domain, "mission"),
      )).limit(200);
      const linkedMission = linkedMissionRows.find((mission) => parseJson(mission.payloadJson).planningPlanId === record.id);
      if (linkedMission) {
        return Response.json({
          error: "planning_linked_mission_requires_resolution",
          detail: `Il piano è collegato alla missione ${linkedMission.title}. Gestisci la missione prima di annullare la pianificazione.`,
          missionId: linkedMission.id,
        }, { status: 409 });
      }
      const nextVersion = record.version + 1;
      const eventId = crypto.randomUUID();
      const cancelledPayload = {
        ...parseJson(record.payloadJson),
        status: "CANCELLED",
        cancelledAt: now,
        cancelledBy: context.actorId,
      };
      const results = await db.batch([
        db.update(jobJourneyRecords).set({
          status: "CANCELLED",
          version: nextVersion,
          payloadJson: JSON.stringify(cancelledPayload),
          updatedBy: context.actorId,
          updatedAt: now,
        }).where(and(
          eq(jobJourneyRecords.tenantId, context.tenantId),
          eq(jobJourneyRecords.id, record.id),
          eq(jobJourneyRecords.version, expectedVersion),
        )).returning(),
        db.insert(s06Events).values({
          eventId,
          tenantId: context.tenantId,
          eventType: "planning.plan.cancelled",
          schemaVersion: "1",
          actorType: "human",
          actorId: context.actorId,
          source: "sites-planning",
          occurredAt: now,
          observedAt: now,
          aggregateType: "job.journey.planning",
          aggregateId: record.id,
          aggregateVersion: nextVersion,
          payloadJson: JSON.stringify({ jobId: job.id, previousStatus: record.status, status: "CANCELLED" }),
          correlationId: crypto.randomUUID(),
          causationId: null,
          idempotencyKey,
          status: "COMMITTED_SITES_READBACK",
          createdAt: now,
        }),
        db.insert(s06Outbox).values({ id: crypto.randomUUID(), tenantId: context.tenantId, eventId, topic: "zerow.planning.plan.cancelled", status: "PENDING_EXTERNAL_CONSUMER", attempts: 0, createdAt: now, updatedAt: now }),
        db.insert(s06Reconciliations).values({ id: crypto.randomUUID(), tenantId: context.tenantId, aggregateType: "job.journey.planning", aggregateId: record.id, expectedVersion: nextVersion, observedVersion: nextVersion, status: "SITES_READBACK_VERIFIED", detail: "Piano annullato e risorse rilasciate con transizione versionata.", createdAt: now, updatedAt: now }),
      ]);
      const cancelled = (results[0] as (typeof jobJourneyRecords.$inferSelect)[])[0];
      if (!cancelled) return Response.json({ error: "version_conflict", currentVersion: record.version }, { status: 409 });
      return Response.json({ plan: recordForResponse(cancelled), eventId, idempotent: false, readback: { status: "verified", scope: "tenant", version: cancelled.version } }, { headers: { "cache-control": "private, no-store" } });
    }
    if (record.status !== "DRAFT") return Response.json({ error: "invalid_planning_transition", status: record.status }, { status: 409 });
    const data = planningData(record);
    const storedActivityType = planningActivityType(data.payload.activityType, jobModule);
    if (!storedActivityType) return Response.json({ error: "invalid_planning_activity_type" }, { status: 409 });
    const selectedResourceIds = Array.isArray(data.payload.selectedResourceIds)
      ? data.payload.selectedResourceIds.filter((value): value is string => typeof value === "string").slice(0, 64)
      : [...new Set(data.slots.flatMap((slot) => slot.resourceIds))].slice(0, 64);
    const startsAt = bounded(data.payload.startsAt, 40, data.slots[0]?.startsAt ?? "");
    const endsAt = bounded(data.payload.endsAt, 40, data.slots[0]?.endsAt ?? "");
    if (!selectedResourceIds.length || !startsAt || !endsAt
      || !Number.isFinite(Date.parse(startsAt))
      || !Number.isFinite(Date.parse(endsAt))
      || Date.parse(endsAt) <= Date.parse(startsAt)) {
      return Response.json({ error: "planning_draft_requires_revalidation" }, { status: 409 });
    }
    let canonicalResources: PlanningResource[];
    try {
      canonicalResources = await resolvePlanningResources(
        context.tenantId,
        selectedResourceIds,
        { startsAt, endsAt },
        planningResourceProfile(storedActivityType),
        record.id,
      );
    } catch (error) {
      if (error instanceof PlanningResourceError) {
        return Response.json({ error: error.code, detail: error.message }, { status: 409 });
      }
      throw error;
    }
    if (canonicalResources.some((resource) => (resource.kind === "person" || resource.kind === "team")
      && !hasCapability(context, "workforce.registry.read")
      && !hasCapability(context, "workforce.read.all"))) {
      return Response.json({ error: "workforce_registry_access_required" }, { status: 403 });
    }
    if (canonicalResources.some((resource) => (resource.kind === "asset" || resource.kind === "vehicle")
      && !hasCapability(context, "asset.read"))) {
      return Response.json({ error: "asset_registry_access_required" }, { status: 403 });
    }
    const compositionError = planningCompositionError(canonicalResources, storedActivityType);
    if (compositionError) return Response.json({ error: "planning_resource_composition_invalid", detail: compositionError }, { status: 409 });
    const evaluation = evaluateAgainstTenant(data.slots, canonicalResources, await activeTenantPlans(context.tenantId, record.id));
    if (!evaluation.feasible) return Response.json({ error: "planning_conflicts", status: "CONFLICTED", evaluation }, { status: 409 });
    const nextPayload = {
      ...data.payload,
      activityType: storedActivityType,
      priority: planningPriority(data.payload.priority) ?? "STANDARD",
      location: canonicalLocation,
      ...canonicalScope,
      selectedResourceIds,
      resources: canonicalResources,
      evaluation,
      publishedAt: now,
      publishedBy: context.actorId,
      status: "PUBLISHED",
    };
    const eventId = crypto.randomUUID();
    const publishUpdate = db.update(jobJourneyRecords).set({
      status: "PUBLISHED",
      version: record.version + 1,
      payloadJson: JSON.stringify(nextPayload),
      updatedBy: context.actorId,
      updatedAt: now,
    }).where(and(
      eq(jobJourneyRecords.tenantId, context.tenantId),
      eq(jobJourneyRecords.id, record.id),
      eq(jobJourneyRecords.version, expectedVersion),
    )).returning();
    const results = await db.batch([
      publishUpdate,
      db.insert(s06Events).values({
        eventId,
        tenantId: context.tenantId,
        eventType: "planning.plan.published",
        schemaVersion: "1",
        actorType: "human",
        actorId: context.actorId,
        source: "sites-planning",
        occurredAt: now,
        observedAt: now,
        aggregateType: "job.journey.planning",
        aggregateId: record.id,
        aggregateVersion: record.version + 1,
        payloadJson: JSON.stringify({ jobId: job.id, status: "PUBLISHED", evaluation }),
        correlationId: crypto.randomUUID(),
        causationId: null,
        idempotencyKey,
        status: "COMMITTED_SITES_READBACK",
        createdAt: now,
      }),
      db.insert(s06Outbox).values({ id: crypto.randomUUID(), tenantId: context.tenantId, eventId, topic: "zerow.planning.plan.published", status: "PENDING_EXTERNAL_CONSUMER", attempts: 0, createdAt: now, updatedAt: now }),
      db.insert(s06Reconciliations).values({ id: crypto.randomUUID(), tenantId: context.tenantId, aggregateType: "job.journey.planning", aggregateId: record.id, expectedVersion: record.version + 1, observedVersion: record.version + 1, status: "SITES_READBACK_VERIFIED", detail: "Piano pubblicato dopo controllo concorrenza e capacità.", createdAt: now, updatedAt: now }),
    ]);
    const updated = (results[0] as (typeof jobJourneyRecords.$inferSelect)[])[0];
    if (!updated) return Response.json({ error: "version_conflict", currentVersion: record.version }, { status: 409 });
    const [readback] = await db.select().from(jobJourneyRecords).where(and(
      eq(jobJourneyRecords.tenantId, context.tenantId),
      eq(jobJourneyRecords.jobId, job.id),
      eq(jobJourneyRecords.id, record.id),
      eq(jobJourneyRecords.version, record.version + 1),
      eq(jobJourneyRecords.status, "PUBLISHED"),
    )).limit(1);
    if (!readback) return Response.json({ error: "planning_readback_unavailable" }, { status: 503 });
    return Response.json({ plan: recordForResponse(readback), evaluation, eventId, idempotent: false, readback: { status: "verified", scope: "tenant", version: readback.version } }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/unique|constraint/i.test(message)) return Response.json({ error: "planning_idempotency_or_version_conflict" }, { status: 409 });
    return Response.json({ error: "planning_write_unavailable" }, { status: 503 });
  }
}
