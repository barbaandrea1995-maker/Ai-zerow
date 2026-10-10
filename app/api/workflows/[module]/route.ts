import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { s04Records, s06Events, s06Outbox, s06Reconciliations, w10Workflows } from "@/db/schema";
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
import { canReadAllOperations, rowMatchesContext, teamScopeTokens } from "@/lib/operational-scope";

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

type W10Line = {
  description: string;
  quantity: number;
  unit: string;
  unitAmountMilli: number;
};

function decimalQuantity(value: unknown) {
  const source = typeof value === "string" ? value.trim().replace(",", ".") : value;
  if (typeof source !== "number" && typeof source !== "string") return null;
  if (typeof source === "string" && !/^\d+(?:\.\d{1,3})?$/.test(source)) return null;
  const quantity = Number(source);
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000_000) return null;
  const milli = Math.round(quantity * 1_000);
  if (!Number.isSafeInteger(milli) || Math.abs(quantity * 1_000 - milli) > 1e-7) return null;
  return milli / 1_000;
}

function arrayValue(value: unknown): W10Line[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 80) return null;
  const lines: W10Line[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    const description = textValue(record.description);
    const quantity = decimalQuantity(record.quantity);
    const unit = textValue(record.unit) || "pz";
    const unitAmountMilli = record.unitAmountMilli === undefined || record.unitAmountMilli === null || record.unitAmountMilli === ""
      ? 0
      : integerValue(record.unitAmountMilli, -1);
    if (description.length < 2 || description.length > 180 || quantity === null || unit.length > 24 || unitAmountMilli < 0 || unitAmountMilli > 9_000_000_000_000) return null;
    lines.push({ description, quantity, unit, unitAmountMilli });
  }
  return lines;
}

function jobForResponse(row: typeof s04Records.$inferSelect) {
  const payload = jsonValue(row.payloadJson);
  return {
    id: row.id,
    code: row.canonicalCode ?? null,
    title: row.title,
    client: textValue(payload.client ?? payload.customer ?? payload.committente, "Cliente da verificare") || null,
    location: textValue(payload.location ?? payload.address ?? payload.cantiere, row.meta) || null,
    status: row.status,
  };
}

async function findOperationJob(tenantId: string, reference: string) {
  const value = textValue(reference).slice(0, 160);
  if (!value) return null;
  const db = getDb();
  const [byId] = await db.select().from(s04Records).where(and(
    eq(s04Records.tenantId, tenantId),
    eq(s04Records.module, "operations"),
    eq(s04Records.id, value),
  )).limit(1);
  if (byId && byId.recordType !== "adapter-contract") return byId;
  const [byCode] = await db.select().from(s04Records).where(and(
    eq(s04Records.tenantId, tenantId),
    eq(s04Records.module, "operations"),
    eq(s04Records.canonicalCode, value),
  )).limit(1);
  return byCode && byCode.recordType !== "adapter-contract" ? byCode : null;
}

async function readOperationJobs(context: NonNullable<Awaited<ReturnType<typeof getAuthorityContext>>>) {
  const rows = await getDb().select().from(s04Records).where(and(
    eq(s04Records.tenantId, context.tenantId),
    eq(s04Records.module, "operations"),
  )).orderBy(desc(s04Records.updatedAt)).limit(250);
  const operationalRows = rows.filter((row) => row.recordType !== "adapter-contract");
  if (canReadAllOperations(context)) return operationalRows.map(jobForResponse);
  const workforceRows = await getDb().select().from(s04Records).where(and(
    eq(s04Records.tenantId, context.tenantId),
    eq(s04Records.module, "workforce"),
  )).limit(500);
  const scopeTokens = teamScopeTokens(workforceRows, context);
  return operationalRows.filter((row) => rowMatchesContext(row, context, scopeTokens)).map(jobForResponse);
}

async function canAccessOperationJob(
  context: NonNullable<Awaited<ReturnType<typeof getAuthorityContext>>>,
  job: typeof s04Records.$inferSelect,
) {
  if (canReadAllOperations(context)) return true;
  const workforceRows = await getDb().select().from(s04Records).where(and(
    eq(s04Records.tenantId, context.tenantId),
    eq(s04Records.module, "workforce"),
  )).limit(500);
  return rowMatchesContext(job, context, teamScopeTokens(workforceRows, context));
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
  jobs: ReturnType<typeof jobForResponse>[] = [],
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
    jobs,
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
    const jobs = hasCapability(context!, "operations.read") ? await readOperationJobs(context!) : [];
    return Response.json(envelope(context!, moduleKey, workflows, jobs), { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "w10_readback_unavailable", module: moduleKey }, { status: 503 });
  }
}

export async function POST(request: Request, routeContext: RouteContext) {
  const moduleKey = await moduleFromRoute(routeContext);
  if (!moduleKey) return Response.json({ error: "unknown_w10_module" }, { status: 404 });
  const context = await getAuthorityContext();
  if (!context) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const readDenied = forbidden(context, moduleKey, W10_MODULES[moduleKey].read);
  if (readDenied) return readDenied;

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
    const amountMilli = payload.amountMilli === undefined ? 0 : integerValue(payload.amountMilli, -1);
    const jobReference = textValue(payload.jobId);
    const supplier = textValue(payload.supplier);
    const lines = moduleKey === "procurement" ? arrayValue(payload.lines) : [];
    if (title.length < 2 || title.length > 140) return Response.json({ error: "title_must_be_2_to_140_characters" }, { status: 400 });
    if (detail.length > 600 || supplier.length > 160 || !/^[A-Z]{3}$/.test(currency)) return Response.json({ error: "workflow_field_invalid" }, { status: 400 });
    if (amountMilli < 0 || amountMilli > 9_000_000_000_000) return Response.json({ error: "amount_out_of_range" }, { status: 400 });
    if (!lines) return Response.json({ error: "procurement_lines_invalid", maxLines: 80, quantityPrecision: 3 }, { status: 400 });

    try {
      if (jobReference) {
        const jobsDenied = forbidden(context, moduleKey, "operations.read");
        if (jobsDenied) return jobsDenied;
      }
      const operationJob = jobReference ? await findOperationJob(context.tenantId, jobReference) : null;
      if (jobReference && !operationJob) return Response.json({ error: "w10_job_not_found" }, { status: 404 });
      if (operationJob && !(await canAccessOperationJob(context, operationJob))) return Response.json({ error: "w10_job_not_found" }, { status: 404 });
      const jobId = operationJob?.id ?? null;
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
      const payloadJson = JSON.stringify({ source: "sites-w10-workflow", createdAt: now });
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
