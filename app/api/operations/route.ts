import { and, desc, eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { getDb } from "@/db";
import { companyAiJobScopes, geofences, geoLocations, jobJourneyRecords, jobStockRegisters, s04Records, s06Events, s06Outbox, s06Reconciliations, s07AiLedger } from "@/db/schema";
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
  type JobWorkItem,
  type JobPayload,
} from "@/lib/operations-contract";
import { getCompanyAiKnowledgePackSummary, searchCompanyAiKnowledge, searchCompanyAiKnowledgeForScope } from "@/lib/company-ai-knowledge";
import { COMMESSA_TYPES, resolveCompanyAiScopeSelection } from "@/lib/company-ai-scope";
import { confirmCompanyAiMacroScopeProposal, getCompanyAiMacroScopeCatalog, type CompanyAiMacroScopeConfirmation } from "@/lib/company-ai-macro-scope";
import { ACTIVE_GEOCODING_PROVIDER, geocodeAddress } from "@/lib/location-intelligence/providers";
import { defaultGeofenceRadius, geofenceForResponse, locationForResponse } from "@/lib/location-intelligence/repository";
import { canReadAllOperations, rowMatchesContext, teamScopeTokens } from "@/lib/operational-scope";
import { ensureJobStockSchema } from "@/lib/job-stock-schema.server";
import {
  isJobCommercialModel,
  isJobCommercialValueBasis,
  jobCommercialCatalog,
  type JobCommercialTerms,
} from "@/lib/job-commercial-terms";

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

function parseJsonRecord(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function requestedGeocodeCandidate(value: unknown) {
  if (!isRecord(value)) return null;
  const coordinates = isRecord(value.coordinates) ? value.coordinates : value;
  const provider = boundedText(value.provider, 24).toUpperCase();
  const providerPlaceId = boundedText(value.providerPlaceId, 160);
  const latitude = Number(coordinates.latitude);
  const longitude = Number(coordinates.longitude);
  if (provider !== ACTIVE_GEOCODING_PROVIDER || !providerPlaceId || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { provider: ACTIVE_GEOCODING_PROVIDER, providerPlaceId, latitude, longitude };
}

function normalizeWorkItems(value: unknown): JobWorkItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const label = boundedText(item.label ?? item.detail, 180);
    if (label.length < 2) return [];
    const confidenceValue = typeof item.confidence === "number" ? item.confidence : Number(item.confidence);
    const scopeInput = isRecord(item.scope) ? item.scope : {};
    const scope = resolveCompanyAiScopeSelection({
      sectionId: boundedText(scopeInput.sectionId, 80),
      groupId: boundedText(scopeInput.groupId, 120),
      subgroupId: boundedText(scopeInput.subgroupId, 160),
    });
    return [{
      id: boundedText(item.id, 80, `work-${index + 1}`),
      label,
      detail: boundedText(item.detail, 520, label),
      quantity: boundedText(item.quantity, 40),
      unit: boundedText(item.unit, 24),
      confidence: Number.isFinite(confidenceValue) ? Math.max(0, Math.min(1, confidenceValue)) : 0.7,
      source: boundedText(item.source, 120, "commessa-intake"),
      ...(scope ? { scope: { ...scope, source: scopeInput.source === "company-ai-proposal-confirmed" ? "company-ai-proposal-confirmed" as const : "human-authored" as const } } : {}),
    } satisfies JobWorkItem];
  }).slice(0, 24);
}

function parseEuroMinor(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0 || value > 1_000_000_000) return null;
    const minor = value * 100;
    return Number.isSafeInteger(minor) ? minor : null;
  }
  if (typeof value !== "string" || !value.trim()) return null;
  let normalized = value.replace(/[€\s]/g, "").trim();
  if (!/^[\d.,]+$/.test(normalized)) return null;
  const comma = normalized.lastIndexOf(",");
  const dot = normalized.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    const decimalMark = comma > dot ? "," : ".";
    const groupingMark = decimalMark === "," ? "." : ",";
    normalized = normalized.split(groupingMark).join("").replace(decimalMark, ".");
  } else if (comma >= 0) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else if (dot >= 0 && /^\d{1,3}(?:\.\d{3})+$/.test(normalized)) {
    normalized = normalized.replace(/\./g, "");
  }
  if (!/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(normalized)) return null;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000_000) return null;
  const minor = Math.round(amount * 100);
  return Number.isSafeInteger(minor) ? minor : null;
}

function knowledgeContextForScope(scopeSelection: NonNullable<ReturnType<typeof resolveCompanyAiScopeSelection>>, workItems: JobWorkItem[]) {
  const byId = new Map<string, ReturnType<typeof searchCompanyAiKnowledge>[number]>();
  for (const entry of searchCompanyAiKnowledgeForScope(scopeSelection, 5)) byId.set(entry.id, entry);
  for (const item of workItems.slice(0, 12)) {
    for (const entry of searchCompanyAiKnowledge(item.detail, { part: scopeSelection.knowledgePart, limit: 3 })) {
      const current = byId.get(entry.id);
      if (!current || entry.score > current.score) byId.set(entry.id, entry);
    }
  }
  return [...byId.values()].sort((left, right) => right.score - left.score || left.id.localeCompare(right.id)).slice(0, 8);
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
    options: {
      commercial: {
        openingTypes: COMMESSA_TYPES.map((option) => ({ ...option })),
        ...jobCommercialCatalog(),
      },
      catalogAuthority: {
        openingTypes: "SERVER_CONTRACT",
        pricingModels: "SERVER_CONTRACT",
        valueBases: "SERVER_CONTRACT",
      },
    },
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
    const db = getDb();
    const [rows, workforceRows] = await Promise.all([
      db.select().from(s04Records)
        .where(and(eq(s04Records.tenantId, context.tenantId), eq(s04Records.module, "operations")))
        .orderBy(desc(s04Records.updatedAt)),
      db.select().from(s04Records)
        .where(and(eq(s04Records.tenantId, context.tenantId), eq(s04Records.module, "workforce")))
        .limit(500),
    ]);
    const scopeTokens = teamScopeTokens(workforceRows, context);
    const visibleRows = canReadAllOperations(context)
      ? rows
      : rows.filter((row) => rowMatchesContext(row, context, scopeTokens));
    return Response.json(operationEnvelope(context, visibleRows.map(recordForResponse)), {
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
  const hasMacroScopeInput = input.scopeV2 !== undefined;
  if (hasMacroScopeInput && !isRecord(input.scopeV2)) {
    return Response.json({ error: "company_ai_scope_confirmation_invalid" }, { status: 400 });
  }
  const macroScopeInput = hasMacroScopeInput ? input.scopeV2 as Record<string, unknown> : null;
  const macroScopePreviewId = boundedText(macroScopeInput?.previewId, 120);
  const rawDescription = typeof (input.description ?? input.detail) === "string" ? String(input.description ?? input.detail) : "";
  if (hasMacroScopeInput && rawDescription.length > 2_000) return Response.json({ error: "field_length_exceeded" }, { status: 400 });
  const description = hasMacroScopeInput ? rawDescription : boundedText(input.description ?? input.detail, 2_000);
  const client = boundedText(input.client, 160);
  const location = boundedText(input.location ?? input.worksite ?? input.detail, 240, "Ubicazione da definire");
  const requestedCategory = boundedText(input.category, 80, "Operations");
  const dueDate = boundedText(input.dueDate ?? input.meta, 40, "Da pianificare");
  const priority = validPriority(input.priority);
  const statusCode = normalizeJobStatus(input.statusCode ?? input.status ?? "DRAFT");
  const openingType = boundedText(input.openingType, 80, "NUOVA_COMMESSA").toUpperCase();
  const scopeInput = isRecord(input.scope) ? input.scope : input;
  const scopeSelection = resolveCompanyAiScopeSelection({
    sectionId: boundedText(scopeInput.scopeSectionId ?? scopeInput.sectionId, 80),
    groupId: boundedText(scopeInput.scopeGroupId ?? scopeInput.groupId, 120),
    subgroupId: boundedText(scopeInput.scopeSubgroupId ?? scopeInput.subgroupId, 160),
  });
  const scopePartCount = [scopeInput.scopeSectionId ?? scopeInput.sectionId, scopeInput.scopeGroupId ?? scopeInput.groupId, scopeInput.scopeSubgroupId ?? scopeInput.subgroupId].filter((value) => boundedText(value, 160)).length;
  const rawWorkItems = Array.isArray(input.workItems) ? input.workItems : [];
  if (rawWorkItems.length > 24 || rawWorkItems.some((item) => !isRecord(item) || boundedText(item.label ?? item.detail, 180).length < 2)) {
    return Response.json({ error: "work_items_invalid", message: "Inserisci al massimo 24 lavorazioni, ciascuna con una descrizione valida." }, { status: 400 });
  }
  const hasInvalidWorkItemScope = rawWorkItems.some((item) => {
    if (!isRecord(item) || !isRecord(item.scope)) return false;
    const scope = item.scope;
    const fields = {
      sectionId: boundedText(scope.sectionId, 80),
      groupId: boundedText(scope.groupId, 120),
      subgroupId: boundedText(scope.subgroupId, 160),
    };
    return Object.values(fields).some(Boolean) && !resolveCompanyAiScopeSelection(fields);
  });
  if (hasInvalidWorkItemScope) {
    return Response.json({ error: "work_item_scope_invalid", message: "La classificazione di una lavorazione non corrisponde al catalogo tecnico aziendale." }, { status: 400 });
  }
  let workItems = normalizeWorkItems(input.workItems);
  const workItemScopeIds = new Set(workItems.map((item) => item.scope?.subgroupId).filter(Boolean));
  const firstWorkItemScope = workItems[0]?.scope;
  const commonWorkItemScope = firstWorkItemScope && workItems.length > 0 && workItems.every((item) => item.scope?.subgroupId === firstWorkItemScope.subgroupId)
    ? firstWorkItemScope
    : null;
  let category = scopeSelection?.sectionTitle ?? commonWorkItemScope?.sectionTitle ?? (workItemScopeIds.size > 1 ? "Lavorazioni miste" : requestedCategory);
  const jobType = boundedText(input.jobType, 120, scopeSelection?.groupTitle ?? commonWorkItemScope?.groupTitle ?? "");
  const specialization = boundedText(input.specialization, 120, scopeSelection?.subgroupTitle ?? commonWorkItemScope?.subgroupTitle ?? "");
  const sourceMode = input.sourceMode === "COMPANY_AI" ? "COMPANY_AI" : "MANUAL";
  const aiPreviewId = boundedText(input.aiPreviewId, 120);
  const clientName = boundedText(input.clientName ?? input.client, 160, client);
  const clientTaxId = boundedText(input.clientTaxId, 80);
  const clientContact = boundedText(input.clientContact, 120);
  const clientPhone = boundedText(input.clientPhone, 80);
  const clientEmail = boundedText(input.clientEmail, 160);
  const clientReference = boundedText(input.clientReference, 160);
  const clientAddress = boundedText(input.clientAddress, 240);
  const worksite = boundedText(input.worksite ?? input.location, 240);
  const requestedWorksiteLocation = requestedGeocodeCandidate(input.worksiteLocation);
  const accessNotes = boundedText(input.accessNotes, 2_000);
  const cig = boundedText(input.cig, 80);
  const cup = boundedText(input.cup, 80);
  const tone = validTone(input.tone);
  const requestedIdempotencyKey = boundedText(input.idempotencyKey, 160);
  const commercialValueInput = isRecord(input.commercialValue) ? input.commercialValue : {};
  const commercialTermsInput = isRecord(input.commercialTerms) ? input.commercialTerms : {};
  const rawCommercialAmount = commercialTermsInput.amount ?? commercialValueInput.amount ?? input.commercialValueAmount;
  const rawCommercialBasis = commercialTermsInput.basis ?? commercialValueInput.basis ?? input.commercialValueBasis;
  const rawCommercialModel = commercialTermsInput.model ?? input.commercialModel;
  const commercialAmountMinor = parseEuroMinor(rawCommercialAmount);
  const commercialValueBasis = rawCommercialBasis === "CONTRACTED" ? "CONTRACTED" : "ESTIMATE";
  const hasCommercialAmount = rawCommercialAmount !== undefined && rawCommercialAmount !== null && String(rawCommercialAmount).trim().length > 0;
  const commercialModel = isJobCommercialModel(rawCommercialModel)
    ? rawCommercialModel
    : hasCommercialAmount ? "FIXED_TOTAL" : "UNDEFINED";

  if (title.length < 2) return Response.json({ error: "title_must_be_2_to_120_characters" }, { status: 400 });
  if (!COMMESSA_TYPES.some((option) => option.value === openingType)) return Response.json({ error: "invalid_commessa_type", allowed: COMMESSA_TYPES.map((option) => option.value) }, { status: 400 });
  if (scopePartCount > 0 && !scopeSelection) return Response.json({ error: "scope_must_end_at_subgroup", message: "Completa la classificazione tecnica facoltativa fino al sottogruppo." }, { status: 400 });
  if (description.trim().length < 8 && workItems.length === 0) return Response.json({ error: "work_description_required", message: "Descrivi il lavoro o inserisci almeno una lavorazione." }, { status: 400 });
  if (rawCommercialBasis !== undefined && rawCommercialBasis !== null && rawCommercialBasis !== "" && !isJobCommercialValueBasis(rawCommercialBasis)) {
    return Response.json({ error: "commercial_value_basis_invalid", allowed: ["ESTIMATE", "CONTRACTED"] }, { status: 400 });
  }
  if (rawCommercialModel !== undefined && rawCommercialModel !== null && rawCommercialModel !== "" && !isJobCommercialModel(rawCommercialModel)) {
    return Response.json({ error: "commercial_model_invalid", allowed: jobCommercialCatalog().pricingModels.map((option) => option.value) }, { status: 400 });
  }
  if (commercialTermsInput.currency !== undefined && commercialTermsInput.currency !== "EUR") {
    return Response.json({ error: "commercial_currency_invalid", allowed: ["EUR"] }, { status: 400 });
  }
  if (hasCommercialAmount && commercialAmountMinor === null) return Response.json({ error: "commercial_value_invalid", message: "Inserisci un importo valido in euro." }, { status: 400 });
  if (hasCommercialAmount && commercialAmountMinor === 0) return Response.json({ error: "commercial_value_must_be_positive" }, { status: 400 });
  if (hasCommercialAmount && commercialModel !== "FIXED_TOTAL" && commercialModel !== "MIXED") {
    return Response.json({ error: "commercial_value_not_allowed_for_model", model: commercialModel }, { status: 400 });
  }
  if (commercialModel === "FIXED_TOTAL" && commercialAmountMinor === null) {
    return Response.json({ error: "commercial_value_required_for_fixed_total" }, { status: 400 });
  }
  if (statusCode === "COMPLETED" || statusCode === "CLOSED") {
    return Response.json({ error: "new_job_must_start_before_completion" }, { status: 400 });
  }
  if (worksite.length < 5) return Response.json({ error: "worksite_address_required" }, { status: 400 });
  if (!requestedWorksiteLocation) return Response.json({ error: "worksite_location_confirmation_required" }, { status: 409 });
  if (description.length > 2_000 || client.length > 160 || location.length > 240 || worksite.length > 240 || category.length > 80 || dueDate.length > 40 || openingType.length > 80 || jobType.length > 120 || specialization.length > 120 || accessNotes.length > 2_000) {
    return Response.json({ error: "field_length_exceeded" }, { status: 400 });
  }
  if (typeof input.idempotencyKey === "string" && input.idempotencyKey.trim().length > 160) {
    return Response.json({ error: "idempotency_key_too_long" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const idempotencyKey = hasMacroScopeInput
    ? `operations:create:macro-scope:${macroScopePreviewId}`.slice(0, 160)
    : requestedIdempotencyKey || `operations:create:${crypto.randomUUID()}`;
  const correlationId = boundedText(input.correlationId, 120) || crypto.randomUUID();
  let scopeV2Confirmation: CompanyAiMacroScopeConfirmation | null = null;

  try {
    await ensureJobStockSchema();
    const db = getDb();
    const existing = await db
      .select()
      .from(s06Events)
      .where(and(eq(s06Events.tenantId, context.tenantId), eq(s06Events.idempotencyKey, idempotencyKey)))
      .limit(1);
    if (existing[0]) {
      if (existing[0].aggregateType !== "commessa") {
        return Response.json({ error: "operations_idempotency_key_conflict" }, { status: 409 });
      }
      const [existingRecord] = await db.select().from(s04Records)
        .where(and(
          eq(s04Records.tenantId, context.tenantId),
          eq(s04Records.module, "operations"),
          eq(s04Records.canonicalCode, existing[0].aggregateId),
        ))
        .limit(1);
      if (!existingRecord) return Response.json({ error: "operations_idempotency_readback_unavailable" }, { status: 503 });
      const existingPayload = parseJsonRecord(existingRecord.payloadJson);
      if (isRecord(existingPayload.commercialTerms)) {
        const [termsReadback] = await db.select({ id: jobJourneyRecords.id }).from(jobJourneyRecords)
          .where(and(
            eq(jobJourneyRecords.tenantId, context.tenantId),
            eq(jobJourneyRecords.jobId, existingRecord.id),
            eq(jobJourneyRecords.domain, "finance"),
            eq(jobJourneyRecords.recordType, "JOB_COMMERCIAL_TERMS"),
            eq(jobJourneyRecords.status, "ACTIVE"),
          ))
          .orderBy(desc(jobJourneyRecords.version), desc(jobJourneyRecords.updatedAt))
          .limit(1);
        if (!termsReadback) return Response.json({ error: "finance_job_terms_readback_unavailable" }, { status: 503 });
      }
      if (isRecord(existingPayload.commercialValue)) {
        const [valueReadback] = await db.select({ id: jobJourneyRecords.id }).from(jobJourneyRecords)
          .where(and(
            eq(jobJourneyRecords.tenantId, context.tenantId),
            eq(jobJourneyRecords.jobId, existingRecord.id),
            eq(jobJourneyRecords.domain, "finance"),
            eq(jobJourneyRecords.recordType, "JOB_COMMERCIAL_VALUE"),
            eq(jobJourneyRecords.status, "ACTIVE"),
          ))
          .orderBy(desc(jobJourneyRecords.version), desc(jobJourneyRecords.updatedAt))
          .limit(1);
        if (!valueReadback) return Response.json({ error: "finance_job_value_readback_unavailable" }, { status: 503 });
      }
      const rows = await db.select().from(s04Records)
        .where(and(eq(s04Records.tenantId, context.tenantId), eq(s04Records.module, "operations")))
        .orderBy(desc(s04Records.updatedAt));
      return Response.json({ ...operationEnvelope(context, rows.map(recordForResponse)), created: recordForResponse(existingRecord), idempotent: true, eventId: existing[0].eventId }, {
        headers: { "cache-control": "no-store" },
      });
    }

    let scopePreviewRow: typeof s07AiLedger.$inferSelect | null = null;
    if (hasMacroScopeInput) {
      if (!macroScopePreviewId || macroScopeInput?.confirmed !== true) {
        return Response.json({ error: "company_ai_scope_confirmation_required" }, { status: 409 });
      }
      const [preview] = await db.select().from(s07AiLedger).where(and(
        eq(s07AiLedger.tenantId, context.tenantId),
        eq(s07AiLedger.id, macroScopePreviewId),
      )).limit(1);
      if (!preview
        || preview.entryType !== "commessa_intake_preview"
        || preview.actionType !== "operations.commessa_macro_scope_v2"
        || preview.status !== "PREVIEW_ONLY"
        || preview.requestedBy !== context.actorId
        || preview.relatedActionId) {
        return Response.json({ error: "company_ai_scope_preview_unavailable_or_consumed" }, { status: 409 });
      }
      const previewPayload = parseJsonRecord(preview.payloadJson);
      const proposal = previewPayload.scopeV2;
      if (!isRecord(proposal)
        || proposal.schemaVersion !== 2
        || typeof proposal.descriptionOriginal !== "string"
        || proposal.descriptionOriginal !== description) {
        return Response.json({ error: "company_ai_scope_description_mismatch" }, { status: 409 });
      }
      const catalog = getCompanyAiMacroScopeCatalog(context.tenantId);
      const confirmation = confirmCompanyAiMacroScopeProposal({
        proposal: proposal as unknown as Parameters<typeof confirmCompanyAiMacroScopeProposal>[0]["proposal"],
        submitted: macroScopeInput,
        catalog,
        actorId: context.actorId,
        confirmedAt: now,
      });
      if (!confirmation) {
        return Response.json({ error: "company_ai_scope_confirmation_invalid", message: "La proposta è cambiata o contiene ambiti e citazioni non validi. Analizzala di nuovo e conferma la versione aggiornata." }, { status: 409 });
      }
      scopePreviewRow = preview;
      scopeV2Confirmation = confirmation.confirmation;
      workItems = confirmation.workItems;
      const labels = catalog.enabledGroups
        .filter((group) => confirmation.confirmation.groupsConfirmed.includes(group.id))
        .map((group) => group.label);
      if (confirmation.confirmation.groupsConfirmed.includes(catalog.fallback.id)) labels.push(catalog.fallback.label);
      category = labels.join(" · ").slice(0, 80) || catalog.fallback.label;
    }

    const geocode = await geocodeAddress(worksite);
    if (geocode.status === "not_configured") {
      return Response.json({ error: "worksite_geocoder_not_configured", provider: ACTIVE_GEOCODING_PROVIDER }, { status: 503 });
    }
    if (geocode.status === "unavailable") {
      return Response.json({ error: "worksite_geocoder_unavailable", provider: ACTIVE_GEOCODING_PROVIDER }, { status: 503 });
    }
    const serverWorksiteLocation = geocode.candidates.find((candidate) => candidate.providerPlaceId === requestedWorksiteLocation.providerPlaceId);
    if (!serverWorksiteLocation) {
      return Response.json({ error: "worksite_location_candidate_mismatch", provider: ACTIVE_GEOCODING_PROVIDER }, { status: 409 });
    }

    assertTenantScope(context, context.tenantId);
    const naming = await allocateServerName({
      tenantId: context.tenantId,
      module: "operations",
      description: title,
    });
    if (!naming) return Response.json({ error: "canonical_code_unavailable" }, { status: 503 });

    const id = `OPERATIONS-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const jobStockRegisterId = `job-stock:${id}`;
    const eventId = crypto.randomUUID();
    const scopeId = `COMPANY-AI-SCOPE-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const scopeEventId = crypto.randomUUID();
    const commercialTermsId = `JOB-COMMERCIAL-TERMS-${crypto.randomUUID().slice(0, 10).toUpperCase()}`;
    const commercialValueId = commercialAmountMinor !== null ? `JOB-COMMERCIAL-VALUE-${crypto.randomUUID().slice(0, 10).toUpperCase()}` : null;
    const geoLocationId = `GEO-CANTIERE-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
    const geofenceId = `GEOFENCE-CANTIERE-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
    const geofenceRadius = defaultGeofenceRadius("CANTIERE");
    const scopeIdempotencyKey = `company-ai-scope:create:${idempotencyKey}`.slice(0, 160);
    const knowledgePack = getCompanyAiKnowledgePackSummary();
    const knowledgeContext = scopeSelection ? knowledgeContextForScope(scopeSelection, workItems) : [];
    const commercialValue = commercialAmountMinor !== null ? {
      amountMinor: commercialAmountMinor,
      currency: "EUR",
      basis: commercialValueBasis,
      version: 1,
      effectiveAt: now,
      source: sourceMode === "COMPANY_AI" ? "company-ai-proposal-confirmed" : "human-authored",
    } : null;
    const commercialTerms: JobCommercialTerms = {
      model: commercialModel,
      currency: "EUR",
      basis: commercialValueBasis,
      baseAmountMinor: commercialAmountMinor,
      version: 1,
      effectiveAt: now,
      source: sourceMode === "COMPANY_AI" ? "company-ai-proposal-confirmed" : "human-authored",
    };
    const persistedWorksiteLocation = {
      provider: serverWorksiteLocation.provider,
      providerPlaceId: serverWorksiteLocation.providerPlaceId,
      formattedAddress: serverWorksiteLocation.formattedAddress,
      address: {
        street: serverWorksiteLocation.street,
        streetNumber: serverWorksiteLocation.streetNumber,
        city: serverWorksiteLocation.city,
        province: serverWorksiteLocation.province,
        postalCode: serverWorksiteLocation.postalCode,
        country: serverWorksiteLocation.country,
      },
      coordinates: {
        latitude: serverWorksiteLocation.latitude,
        longitude: serverWorksiteLocation.longitude,
      },
      confidence: serverWorksiteLocation.confidence,
      status: "SERVER_VERIFIED",
      geoLocationId,
      geofenceId,
      geofence: { shapeType: "CIRCLE", radiusMeters: geofenceRadius },
      verifiedAt: now,
    };
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
      location: serverWorksiteLocation.formattedAddress,
      worksite: serverWorksiteLocation.formattedAddress,
      worksiteLocation: persistedWorksiteLocation,
      worksiteGeoLocationId: geoLocationId,
      worksiteGeofenceId: geofenceId,
      worksiteGeocodeStatus: "CONFIRMED",
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
      workItems,
      sourceMode,
      aiPreviewId: macroScopePreviewId || aiPreviewId || null,
      scopeLevel: scopeSelection?.level ?? null,
      scopeSectionId: scopeSelection?.sectionId ?? "",
      scopeGroupId: scopeSelection?.groupId ?? "",
      scopeSubgroupId: scopeSelection?.subgroupId ?? "",
      scope: scopeSelection ? {
        ...scopeSelection,
        source: sourceMode === "COMPANY_AI" ? "company-ai-proposal-confirmed" : "human-authored",
      } : null,
      ...(scopeV2Confirmation ? { scopeV2: scopeV2Confirmation } : {}),
      commercialTerms,
      commercialValue,
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
      scope: scopeSelection ? { level: scopeSelection.level, sectionId: scopeSelection.sectionId, groupId: scopeSelection.groupId, subgroupId: scopeSelection.subgroupId } : null,
      macroScopeV2: scopeV2Confirmation ? {
        catalogVersion: scopeV2Confirmation.catalogVersion,
        previewId: macroScopePreviewId,
        status: scopeV2Confirmation.status,
        groupsConfirmed: scopeV2Confirmation.groupsConfirmed,
        activityCount: scopeV2Confirmation.activitiesConfirmed.filter((activity) => activity.status === "CONFERMATA").length,
        changes: scopeV2Confirmation.changes,
      } : null,
      commercialValue,
      commercialTerms,
      worksiteLocation: {
        status: "SERVER_VERIFIED",
        provider: serverWorksiteLocation.provider,
        providerPlaceId: serverWorksiteLocation.providerPlaceId,
        geoLocationId,
        geofenceId,
        geofenceRadiusMeters: geofenceRadius,
      },
      workItemCount: workItems.length,
      jobStockRegister: { id: jobStockRegisterId, status: "ACTIVE", version: 1 },
      workPackageScopes: workItems.flatMap((item) => item.scope ? [{ workItemId: item.id, sectionId: item.scope.sectionId, groupId: item.scope.groupId, subgroupId: item.scope.subgroupId }] : []),
      version: 1,
      source: sourceMode === "COMPANY_AI" ? "company-ai-proposal-confirmed" : "manual-intake",
    });

    const writeStatements: [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] = [
      db.insert(s04Records).values({
        id,
        tenantId: context.tenantId,
        module: "operations",
        canonicalCode: naming.canonicalCode,
        recordType: "job",
        title: naming.canonicalCode,
        detail: serverWorksiteLocation.formattedAddress,
        meta: dueDate,
        status: jobStatusLabel(statusCode),
        tone,
        progress: 0,
        payloadJson: serializedPayload,
        createdBy: context.actorId,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(jobStockRegisters).values({
        id: jobStockRegisterId,
        tenantId: context.tenantId,
        jobId: id,
        jobCode: naming.canonicalCode,
        status: "ACTIVE",
        version: 1,
        openedAt: now,
        closedAt: null,
        createdBy: context.actorId,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(geoLocations).values({
        id: geoLocationId,
        tenantId: context.tenantId,
        entityType: "CANTIERE",
        entityId: id,
        formattedAddress: serverWorksiteLocation.formattedAddress,
        street: serverWorksiteLocation.street,
        streetNumber: serverWorksiteLocation.streetNumber,
        city: serverWorksiteLocation.city,
        province: serverWorksiteLocation.province,
        postalCode: serverWorksiteLocation.postalCode,
        country: serverWorksiteLocation.country,
        latitudeE6: Math.round(serverWorksiteLocation.latitude * 1_000_000),
        longitudeE6: Math.round(serverWorksiteLocation.longitude * 1_000_000),
        provider: serverWorksiteLocation.provider,
        providerPlaceId: serverWorksiteLocation.providerPlaceId,
        geocodeConfidenceMilli: Math.round(Math.min(1, Math.max(0, serverWorksiteLocation.confidence)) * 1_000),
        verifiedByUser: 1,
        verifiedAt: now,
        status: "ACTIVE",
        version: 1,
        idempotencyKey: `operations-worksite-location:${context.tenantId}:${id}`.slice(0, 160),
        createdBy: context.actorId,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(geofences).values({
        id: geofenceId,
        tenantId: context.tenantId,
        locationId: geoLocationId,
        entityType: "CANTIERE",
        entityId: id,
        name: `${naming.canonicalCode} · Cantiere`,
        shapeType: "CIRCLE",
        centerLatitudeE6: Math.round(serverWorksiteLocation.latitude * 1_000_000),
        centerLongitudeE6: Math.round(serverWorksiteLocation.longitude * 1_000_000),
        radiusMeters: geofenceRadius,
        polygonJson: "[]",
        status: "ACTIVE",
        version: 1,
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
        detail: "Creazione commessa, ubicazione riconosciuta e geofence persistite su D1; consumer canonico esterno ancora differito.",
        createdAt: now,
        updatedAt: now,
      }),
    ];
    if (scopePreviewRow && scopeV2Confirmation) {
      writeStatements.push(db.update(s07AiLedger).set({
        status: "APPROVED",
        approvalRequired: 0,
        relatedActionId: id,
        approvedBy: context.actorId,
        readbackJson: JSON.stringify({ status: "COMMESSA_CREATA", aggregateId: naming.canonicalCode, checkedAt: now }),
      }).where(and(
        eq(s07AiLedger.tenantId, context.tenantId),
        eq(s07AiLedger.id, scopePreviewRow.id),
        eq(s07AiLedger.status, "PREVIEW_ONLY"),
      )));
    }
    if (scopeSelection) {
      writeStatements.push(
        db.insert(companyAiJobScopes).values({
        id: scopeId,
        tenantId: context.tenantId,
        jobId: id,
        jobCode: naming.canonicalCode,
        knowledgePackId: knowledgePack.id,
        knowledgePackVersion: knowledgePack.version,
        scopeLevel: scopeSelection.level,
        scopeSectionId: scopeSelection.sectionId,
        scopeGroupId: scopeSelection.groupId,
        scopeSubgroupId: scopeSelection.subgroupId,
        scopeText: [description, ...workItems.map((item) => item.detail)].filter(Boolean).join("\n").slice(0, 12_000),
        knowledgeEntryIdsJson: JSON.stringify(knowledgeContext.map((entry) => entry.id)),
        assumptionsJson: "[]",
        exclusionsJson: "[]",
        status: "DRAFT",
        source: sourceMode === "COMPANY_AI" ? "company-ai-proposal-confirmed" : "human-authored",
        version: 1,
        idempotencyKey: scopeIdempotencyKey,
        createdBy: context.actorId,
        createdAt: now,
        updatedAt: now,
      }),
        db.insert(s06Events).values({
        eventId: scopeEventId,
        tenantId: context.tenantId,
        eventType: "company_ai.scope.linked",
        schemaVersion: "1",
        actorType: "human",
        actorId: context.actorId,
        source: "sites-command",
        occurredAt: now,
        observedAt: now,
        aggregateType: "company_ai_scope",
        aggregateId: scopeId,
        aggregateVersion: 1,
        payloadJson: JSON.stringify({ action: "link", aggregate: "company_ai_scope", jobId: id, jobCode: naming.canonicalCode, knowledgePackId: knowledgePack.id, knowledgePackVersion: knowledgePack.version, scopeLevel: scopeSelection.level, scopeSectionId: scopeSelection.sectionId, scopeGroupId: scopeSelection.groupId, scopeSubgroupId: scopeSelection.subgroupId, knowledgeContextEntryCount: knowledgeContext.length, version: 1, status: "DRAFT" }),
        correlationId,
        causationId: eventId,
        idempotencyKey: scopeIdempotencyKey,
        status: "COMMITTED_SITES_READBACK",
        createdAt: now,
      }),
        db.insert(s06Outbox).values({
        id: crypto.randomUUID(),
        tenantId: context.tenantId,
        eventId: scopeEventId,
        topic: "zerow.company-ai.scope.linked",
        status: "PENDING_EXTERNAL_CONSUMER",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      }),
        db.insert(s06Reconciliations).values({
        id: crypto.randomUUID(),
        tenantId: context.tenantId,
        aggregateType: "company_ai_scope",
        aggregateId: scopeId,
        expectedVersion: 1,
        observedVersion: 1,
        status: "SITES_READBACK_VERIFIED",
        detail: "Scope gerarchico collegato alla commessa su D1; il contesto tariffario resta reference-only.",
        createdAt: now,
        updatedAt: now,
      }),
        db.insert(s07AiLedger).values({
        id: crypto.randomUUID(),
        tenantId: context.tenantId,
        entryType: "knowledge_scope_link",
        actionType: "company_ai.scope.link",
        command: `Collega il sottogruppo ${scopeSelection.subgroupTitle} alla commessa ${naming.canonicalCode}`,
        status: "DRAFT",
        approvalRequired: 0,
        relatedActionId: scopeId,
        payloadJson: JSON.stringify({ source: sourceMode === "COMPANY_AI" ? "company-ai-proposal-confirmed" : "human-authored", jobId: id, jobCode: naming.canonicalCode, knowledgePackId: knowledgePack.id, knowledgePackVersion: knowledgePack.version, scopeLevel: scopeSelection.level, scopeSectionId: scopeSelection.sectionId, scopeGroupId: scopeSelection.groupId, scopeSubgroupId: scopeSelection.subgroupId, knowledgeContextEntryIds: knowledgeContext.map((entry) => entry.id), version: 1, status: "DRAFT" }),
        requestedBy: context.actorId,
        approvedBy: null,
        readbackJson: JSON.stringify({ status: "SITES_LEDGER_VERIFIED", checkedAt: now }),
        createdAt: now,
        }),
      );
    }
    writeStatements.push(db.insert(jobJourneyRecords).values({
      id: commercialTermsId,
      tenantId: context.tenantId,
      jobId: id,
      domain: "finance",
      recordType: "JOB_COMMERCIAL_TERMS",
      title: "Condizioni economiche della commessa",
      status: "ACTIVE",
      version: 1,
      payloadJson: JSON.stringify(commercialTerms),
      idempotencyKey: `finance:job-commercial-terms:${id}:v1`.slice(0, 160),
      createdBy: context.actorId,
      updatedBy: context.actorId,
      createdAt: now,
      updatedAt: now,
    }));
    if (commercialValue && commercialValueId) {
      writeStatements.push(db.insert(jobJourneyRecords).values({
        id: commercialValueId,
        tenantId: context.tenantId,
        jobId: id,
        domain: "finance",
        recordType: "JOB_COMMERCIAL_VALUE",
        title: "Valore della commessa",
        status: "ACTIVE",
        version: 1,
        payloadJson: JSON.stringify(commercialValue),
        idempotencyKey: `finance:job-commercial-value:${id}:v1`.slice(0, 160),
        createdBy: context.actorId,
        updatedBy: context.actorId,
        createdAt: now,
        updatedAt: now,
      }));
    }
    await db.batch(writeStatements);

    if (scopePreviewRow && scopeV2Confirmation) {
      const [approvedPreviewReadback] = await db.select().from(s07AiLedger).where(and(
        eq(s07AiLedger.tenantId, context.tenantId),
        eq(s07AiLedger.id, scopePreviewRow.id),
      )).limit(1);
      if (!approvedPreviewReadback
        || approvedPreviewReadback.status !== "APPROVED"
        || approvedPreviewReadback.relatedActionId !== id
        || approvedPreviewReadback.approvedBy !== context.actorId) {
        return Response.json({ error: "company_ai_scope_confirmation_readback_unavailable" }, { status: 503 });
      }
    }

    const rows = await db.select().from(s04Records)
      .where(and(eq(s04Records.tenantId, context.tenantId), eq(s04Records.module, "operations")))
      .orderBy(desc(s04Records.updatedAt));
    const created = rows.find((row) => row.id === id);
    if (!created) return Response.json({ error: "operations_readback_unavailable" }, { status: 503 });
    const [locationReadback] = await db.select().from(geoLocations)
      .where(and(eq(geoLocations.tenantId, context.tenantId), eq(geoLocations.id, geoLocationId)))
      .limit(1);
    const [geofenceReadback] = await db.select().from(geofences)
      .where(and(eq(geofences.tenantId, context.tenantId), eq(geofences.id, geofenceId)))
      .limit(1);
    const [jobStockRegisterReadback] = await db.select().from(jobStockRegisters)
      .where(and(
        eq(jobStockRegisters.tenantId, context.tenantId),
        eq(jobStockRegisters.id, jobStockRegisterId),
        eq(jobStockRegisters.jobId, id),
      ))
      .limit(1);
    if (!jobStockRegisterReadback || jobStockRegisterReadback.status !== "ACTIVE") {
      return Response.json({ error: "job_stock_register_readback_unavailable" }, { status: 503, headers: { "cache-control": "private, no-store" } });
    }
    const [commercialTermsRow] = await db.select().from(jobJourneyRecords).where(and(
      eq(jobJourneyRecords.tenantId, context.tenantId),
      eq(jobJourneyRecords.jobId, id),
      eq(jobJourneyRecords.id, commercialTermsId),
      eq(jobJourneyRecords.domain, "finance"),
      eq(jobJourneyRecords.recordType, "JOB_COMMERCIAL_TERMS"),
      eq(jobJourneyRecords.status, "ACTIVE"),
    )).limit(1);
    const commercialTermsPayload = commercialTermsRow ? parseJsonRecord(commercialTermsRow.payloadJson) : {};
    if (!commercialTermsRow
      || commercialTermsPayload.model !== commercialTerms.model
      || commercialTermsPayload.currency !== "EUR"
      || commercialTermsPayload.baseAmountMinor !== commercialTerms.baseAmountMinor) {
      return Response.json({ error: "finance_job_terms_readback_unavailable" }, { status: 503, headers: { "cache-control": "private, no-store" } });
    }
    let commercialValueReadback: { status: "verified"; recordId: string; version: number } | null = null;
    if (commercialValue && commercialValueId) {
      const [valueRow] = await db.select().from(jobJourneyRecords).where(and(
        eq(jobJourneyRecords.tenantId, context.tenantId),
        eq(jobJourneyRecords.jobId, id),
        eq(jobJourneyRecords.id, commercialValueId),
        eq(jobJourneyRecords.domain, "finance"),
        eq(jobJourneyRecords.recordType, "JOB_COMMERCIAL_VALUE"),
        eq(jobJourneyRecords.status, "ACTIVE"),
      )).limit(1);
      const valuePayload = valueRow ? parseJsonRecord(valueRow.payloadJson) : {};
      if (!valueRow || valuePayload.amountMinor !== commercialValue.amountMinor || valuePayload.currency !== "EUR" || valuePayload.basis !== commercialValue.basis) {
        return Response.json({ error: "finance_job_value_readback_unavailable" }, { status: 503, headers: { "cache-control": "private, no-store" } });
      }
      commercialValueReadback = { status: "verified", recordId: valueRow.id, version: valueRow.version };
    }
    return Response.json({
      ...operationEnvelope(context, rows.map(recordForResponse)),
      created: recordForResponse(created),
      location: locationReadback ? locationForResponse(locationReadback) : null,
      geofence: geofenceReadback ? geofenceForResponse(geofenceReadback) : null,
      jobStockRegister: {
        id: jobStockRegisterReadback.id,
        status: jobStockRegisterReadback.status,
        version: jobStockRegisterReadback.version,
        readback: "verified",
      },
      commercialTermsReadback: { status: "verified", recordId: commercialTermsRow.id, version: commercialTermsRow.version },
      financeValueReadback: commercialValueReadback,
      event: { eventId, aggregateId: naming.canonicalCode, aggregateVersion: 1, readback: "verified" },
      idempotent: false,
    }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof CanonicalCodeConflictError) {
      return Response.json({ error: error.code }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE") || message.includes("unique")) {
      return Response.json({ error: "operations_idempotency_or_version_conflict" }, { status: 409 });
    }
    return Response.json({ error: adapterError(error), module: "operations" }, { status: 503 });
  }
}
