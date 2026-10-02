import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { s06Events, s06Outbox, s06Reconciliations, w10Workflows } from "@/db/schema";
import {
  getAuthorityContext,
  hasCapability,
  publicAuthorityContext,
} from "@/lib/authority-context";
import {
  isW10Module,
  transitionW10Workflow,
  w10ExternalStatus,
  w10NextActions,
  w10Progress,
  W10_MODULES,
  type W10Module,
} from "@/lib/w10-contract";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ module: string }> };

function textValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function integerValue(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return fallback;
}

function jsonValue(value: string, fallback: Record<string, unknown> = {}) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : fallback;
  } catch {
    return fallback;
  }
}

function arrayValue(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 80).map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return { value: String(item ?? "") };
    const record = item as Record<string, unknown>;
    return {
      description: textValue(record.description).slice(0, 180),
      quantity: integerValue(record.quantity, 0),
      unit: textValue(record.unit).slice(0, 24),
      unitAmountMilli: integerValue(record.unitAmountMilli, 0),
    };
  });
}

function moduleFromRoute(routeContext: RouteContext) {
  return routeContext.params.then(({ module }) => isW10Module(module) ? module : null);
}

function forbidden(context: Awaited<ReturnType<typeof getAuthorityContext>>, moduleKey: W10Module, capability: string) {
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasCapability(context, capability)) {
    return Response.json({ error: "forbidden", module: moduleKey, capability }, { status: 403 });
  }
  return null;
}

function workflowForResponse(row: typeof w10Workflows.$inferSelect) {
  const payload = jsonValue(row.payloadJson);
  let lines: unknown[] = [];
  try {
    const parsed = JSON.parse(row.linesJson) as unknown;
    if (Array.isArray(parsed)) lines = parsed;
  } catch {
    lines = [];
  }
  const moduleKey = row.module === "finance" ? "finance" : "procurement";
  return {
    id: row.id,
    module: moduleKey,
    recordType: row.recordType,
    title: row.title,
    detail: row.detail,
    status: row.status,
    amountMilli: row.amountMilli,
    currency: row.currency,
    jobId: row.jobId,
    supplier: row.supplier,
    lines,
    payload,
    version: row.version,
    progress: w10Progress(moduleKey, row.status),
    nextActions: w10NextActions(moduleKey, row.status),
    externalStatus: w10ExternalStatus(row.status),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function envelope(
  context: NonNullable<Awaited<ReturnType<typeof getAuthorityContext>>>,
  moduleKey: W10Module,
  workflows: ReturnType<typeof workflowForResponse>[],
) {
  return {
    context: publicAuthorityContext(context),
    module: moduleKey,
    contract: {
      tranche: "W10",
      source: "sites-d1-governed-workflow",
      mutation: "approval-and-reconciliation-gated",
      canonicalExecutor: "external-accounting-or-supplier-service-deferred",
      transitions: moduleKey === "procurement"
        ? "NEED → REQUESTED → REVIEW → APPROVED → PO_DRAFT → external issue → receipt → RECONCILED"
        : "PROPOSED → REVIEW → APPROVED → RECONCILED",
    },
    workflows,
    readback: {
      status: "ok",
      count: workflows.length,
      tenantId: context.tenantId,
      checkedAt: new Date().toISOString(),
    },
  };
}

async function readWorkflows(context: NonNullable<Awaited<ReturnType<typeof getAuthorityContext>>>, moduleKey: W10Module) {
  const rows = await getDb().select().from(w10Workflows).where(and(
    eq(w10Workflows.tenantId, context.tenantId),
    eq(w10Workflows.module, moduleKey),
  )).orderBy(desc(w10Workflows.updatedAt)).limit(100);
  return rows.map(workflowForResponse);
}

async function existingByIdempotency(tenantId: string, idempotencyKey: string) {
  return getDb().select().from(s06Events).where(and(
    eq(s06Events.tenantId, tenantId),
    eq(s06Events.idempotencyKey, idempotencyKey),
  )).limit(1);
}

export async function GET(_request: Request, routeContext: RouteContext) {
  const moduleKey = await moduleFromRoute(routeContext);
  if (!moduleKey) return Response.json({ error: "unknown_w10_module" }, { status: 404 });
  const context = await getAuthorityContext();
  const denied = forbidden(context, moduleKey, W10_MODULES[moduleKey].read);
  if (denied) return denied;
  try {
    const workflows = await readWorkflows(context!, moduleKey);
    return Response.json(envelope(context!, moduleKey, workflows), { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "w10_readback_unavailable", module: moduleKey }, { status: 503 });
  }
}

export async function POST(request: Request, routeContext: RouteContext) {
  const moduleKey = await moduleFromRoute(routeContext);
  if (!moduleKey) return Response.json({ error: "unknown_w10_module" }, { status: 404 });
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });

  let payload: Record<string, unknown>;
  try {
    const parsed = await request.json() as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return Response.json({ error: "invalid_json" }, { status: 400 });
    payload = parsed as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const action = textValue(payload.action, "create");
  const requestedIdempotencyKey = textValue(payload.idempotencyKey).slice(0, 160);
  if (!requestedIdempotencyKey) return Response.json({ error: "idempotency_key_required" }, { status: 400 });

  if (action === "create") {
    const denied = forbidden(context, moduleKey, W10_MODULES[moduleKey].write);
    if (denied) return denied;
    const title = textValue(payload.title);
    const detail = textValue(payload.detail);
    const currency = textValue(payload.currency, "EUR").toUpperCase();
    const amountMilli = integerValue(payload.amountMilli, 0);
    const jobId = textValue(payload.jobId) || null;
    const supplier = textValue(payload.supplier).slice(0, 160);
    const lines = arrayValue(payload.lines);
    if (title.length < 2 || title.length > 140) return Response.json({ error: "title_must_be_2_to_140_characters" }, { status: 400 });
    if (detail.length > 600 || supplier.length > 160 || !/^[A-Z]{3}$/.test(currency)) return Response.json({ error: "workflow_field_invalid" }, { status: 400 });
    if (amountMilli < 0 || amountMilli > 9_000_000_000_000) return Response.json({ error: "amount_out_of_range" }, { status: 400 });

    try {
      const existing = await existingByIdempotency(context.tenantId, requestedIdempotencyKey);
      if (existing[0]) {
        if (existing[0].aggregateType !== `w10.${moduleKey}`) return Response.json({ error: "w10_idempotency_key_conflict" }, { status: 409 });
        const [row] = await getDb().select().from(w10Workflows).where(and(eq(w10Workflows.tenantId, context.tenantId), eq(w10Workflows.id, existing[0].aggregateId))).limit(1);
        if (!row) return Response.json({ error: "w10_idempotency_readback_unavailable" }, { status: 503 });
        return Response.json({ ...envelope(context, moduleKey, await readWorkflows(context, moduleKey)), created: workflowForResponse(row), idempotent: true }, { headers: { "cache-control": "no-store" } });
      }
      const now = new Date().toISOString();
      const id = `W10-${moduleKey.toUpperCase()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const eventId = crypto.randomUUID();
      const initialStatus = W10_MODULES[moduleKey].initialStatus;
      const payloadJson = JSON.stringify({ source: "sites-w10-workflow", createdAt: now, input: payload });
      if (payloadJson.length > 14_000) return Response.json({ error: "payload_too_large" }, { status: 400 });
      await getDb().batch([
        getDb().insert(w10Workflows).values({
          id,
          tenantId: context.tenantId,
          module: moduleKey,
          recordType: moduleKey === "procurement" ? "purchase_request" : "finance_entry",
          title,
          detail,
          status: initialStatus,
          amountMilli,
          currency,
          jobId,
          supplier,
          linesJson: JSON.stringify(lines),
          payloadJson,
          version: 1,
          idempotencyKey: requestedIdempotencyKey,
          createdBy: context.actorId,
          updatedBy: context.actorId,
          createdAt: now,
          updatedAt: now,
        }),
        getDb().insert(s06Events).values({
          eventId,
          tenantId: context.tenantId,
          eventType: `w10.${moduleKey}.workflow.created`,
          schemaVersion: "1",
          actorType: "human",
          actorId: context.actorId,
          source: "sites-command",
          occurredAt: now,
          observedAt: now,
          aggregateType: `w10.${moduleKey}`,
          aggregateId: id,
          aggregateVersion: 1,
          payloadJson: JSON.stringify({ module: moduleKey, status: initialStatus, source: "sites-w10-workflow" }),
          correlationId: crypto.randomUUID(),
          causationId: null,
          idempotencyKey: requestedIdempotencyKey,
          status: "COMMITTED_SITES_READBACK",
          createdAt: now,
        }),
        getDb().insert(s06Outbox).values({
          id: crypto.randomUUID(),
          tenantId: context.tenantId,
          eventId,
          topic: `zerow.${moduleKey}.workflow.created`,
          status: "PENDING_EXTERNAL_CONSUMER",
          attempts: 0,
          createdAt: now,
          updatedAt: now,
        }),
        getDb().insert(s06Reconciliations).values({
          id: crypto.randomUUID(),
          tenantId: context.tenantId,
          aggregateType: `w10.${moduleKey}`,
          aggregateId: id,
          expectedVersion: 1,
          observedVersion: 1,
          status: "SITES_READBACK_VERIFIED",
          detail: "Workflow W10 creato in Sites; executor contabile/fornitore esterno differito.",
          createdAt: now,
          updatedAt: now,
        }),
      ]);
      const [row] = await getDb().select().from(w10Workflows).where(and(eq(w10Workflows.tenantId, context.tenantId), eq(w10Workflows.id, id))).limit(1);
      if (!row) return Response.json({ error: "w10_readback_unavailable" }, { status: 503 });
      return Response.json({ ...envelope(context, moduleKey, await readWorkflows(context, moduleKey)), created: workflowForResponse(row), idempotent: false }, { status: 201, headers: { "cache-control": "no-store" } });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      return Response.json({ error: message.includes("UNIQUE") ? "w10_idempotency_or_version_conflict" : "w10_write_failed" }, { status: message.includes("UNIQUE") ? 409 : 503 });
    }
  }

  const workflowId = textValue(payload.id);
  const expectedVersion = integerValue(payload.expectedVersion, 0);
  if (!workflowId || expectedVersion < 1) return Response.json({ error: "workflow_id_and_expected_version_required" }, { status: 400 });
  const [current] = await getDb().select().from(w10Workflows).where(and(
    eq(w10Workflows.tenantId, context.tenantId),
    eq(w10Workflows.module, moduleKey),
    eq(w10Workflows.id, workflowId),
  )).limit(1);
  if (!current) return Response.json({ error: "w10_workflow_not_found" }, { status: 404 });

  let transition: ReturnType<typeof transitionW10Workflow>;
  try {
    transition = transitionW10Workflow({ module: moduleKey, status: current.status, action });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "w10_invalid_transition" }, { status: 409 });
  }
  const capability = transition.requiresApproval ? "approvals.review" : W10_MODULES[moduleKey].write;
  const denied = forbidden(context, moduleKey, capability);
  if (denied) return denied;
  if (transition.externalOnly) {
    return Response.json({
      error: "external_executor_deferred",
      status: current.status,
      nextStatus: transition.nextStatus,
      detail: "La transizione richiede evidenza del provider esterno; Sites non simula emissione o ricezione.",
    }, { status: 409 });
  }
  if (current.version !== expectedVersion) return Response.json({ error: "version_conflict", current: workflowForResponse(current) }, { status: 409 });

  try {
    const existing = await existingByIdempotency(context.tenantId, requestedIdempotencyKey);
    if (existing[0]) {
      if (existing[0].aggregateId !== workflowId || existing[0].aggregateType !== `w10.${moduleKey}`) return Response.json({ error: "w10_idempotency_key_conflict" }, { status: 409 });
      const [row] = await getDb().select().from(w10Workflows).where(and(eq(w10Workflows.tenantId, context.tenantId), eq(w10Workflows.id, workflowId))).limit(1);
      if (!row) return Response.json({ error: "w10_idempotency_readback_unavailable" }, { status: 503 });
      return Response.json({ ...envelope(context, moduleKey, await readWorkflows(context, moduleKey)), updated: workflowForResponse(row), idempotent: true }, { headers: { "cache-control": "no-store" } });
    }
    const now = new Date().toISOString();
    const eventId = crypto.randomUUID();
    const payloadJson = JSON.stringify({ ...jsonValue(current.payloadJson), lastTransition: { action, from: current.status, to: transition.nextStatus, at: now, actorId: context.actorId, evidence: textValue(payload.evidence).slice(0, 600) } });
    await getDb().batch([
      getDb().update(w10Workflows).set({ status: transition.nextStatus, version: current.version + 1, payloadJson, updatedBy: context.actorId, updatedAt: now }).where(and(eq(w10Workflows.tenantId, context.tenantId), eq(w10Workflows.id, workflowId), eq(w10Workflows.version, expectedVersion))),
      getDb().insert(s06Events).values({
        eventId,
        tenantId: context.tenantId,
        eventType: `w10.${moduleKey}.workflow.${action}`,
        schemaVersion: "1",
        actorType: "human",
        actorId: context.actorId,
        source: "sites-command",
        occurredAt: now,
        observedAt: now,
        aggregateType: `w10.${moduleKey}`,
        aggregateId: workflowId,
        aggregateVersion: current.version + 1,
        payloadJson: JSON.stringify({ module: moduleKey, action, fromStatus: current.status, nextStatus: transition.nextStatus }),
        correlationId: crypto.randomUUID(),
        causationId: null,
        idempotencyKey: requestedIdempotencyKey,
        status: "COMMITTED_SITES_READBACK",
        createdAt: now,
      }),
      getDb().insert(s06Outbox).values({ id: crypto.randomUUID(), tenantId: context.tenantId, eventId, topic: `zerow.${moduleKey}.workflow.${action}`, status: "PENDING_EXTERNAL_CONSUMER", attempts: 0, createdAt: now, updatedAt: now }),
      getDb().insert(s06Reconciliations).values({ id: crypto.randomUUID(), tenantId: context.tenantId, aggregateType: `w10.${moduleKey}`, aggregateId: workflowId, expectedVersion: current.version + 1, observedVersion: current.version + 1, status: "SITES_READBACK_VERIFIED", detail: `Transizione ${current.status} → ${transition.nextStatus} riletta in Sites; eventuale provider esterno resta differito.`, createdAt: now, updatedAt: now }),
    ]);
    const [row] = await getDb().select().from(w10Workflows).where(and(eq(w10Workflows.tenantId, context.tenantId), eq(w10Workflows.id, workflowId))).limit(1);
    if (!row) return Response.json({ error: "w10_readback_unavailable" }, { status: 503 });
    return Response.json({ ...envelope(context, moduleKey, await readWorkflows(context, moduleKey)), updated: workflowForResponse(row), idempotent: false }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return Response.json({ error: message.includes("UNIQUE") ? "w10_idempotency_or_version_conflict" : "w10_write_failed" }, { status: message.includes("UNIQUE") ? 409 : 503 });
  }
}
