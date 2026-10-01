import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { s06Events, s06Outbox, s06Reconciliations, s07AiLedger } from "@/db/schema";
import {
  getCompanyAiKnowledgePackSummary,
  searchCompanyAiKnowledge,
  searchCompanyAiKnowledgeForScope,
} from "@/lib/company-ai-knowledge";
import {
  getS07Context,
  s07AccessDenied,
} from "@/lib/s07-adapter";
import { analyzeCompanyAiWithOpenAi, resolveOpenAiScope } from "@/lib/company-ai-openai";
import {
  DEFAULT_INTAKE_DRAFT,
  INTAKE_FIELD_LABELS,
  type IntakeDraft,
  type IntakeMode,
  type IntakeSuggestion,
} from "@/lib/operations-intake";
import { inferCompanyAiScopeSelection, scopeSelectionToFields, type CompanyAiScopeSuggestion } from "@/lib/company-ai-scope";

export const dynamic = "force-dynamic";

const MAX_INTAKE_SOURCE_CHARS = 60_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function bounded(value: unknown, max: number, fallback = "") {
  return text(value, fallback).slice(0, max);
}

function parseObject(value: string | null) {
  if (!value) return {} as Record<string, unknown>;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {} as Record<string, unknown>;
  }
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function labeledValue(source: string, labels: string[]) {
  for (const label of labels) {
    const match = source.match(new RegExp(`(?:^|\\n)\\s*${escapeRegex(label)}\\s*[:\\-]\\s*(.+)`, "im"));
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return "";
}

const INTAKE_LABELS = [
  "Titolo", "Oggetto", "Commessa", "Lavori", "Descrizione", "Descrizione lavori", "Oggetto lavori",
  "Lavorazioni", "Prestazioni", "Intervento", "Perimetro", "Note operative", "Cliente", "Committente",
  "Ragione sociale", "P. IVA", "PIVA", "Partita IVA", "Codice fiscale", "Referente", "Referente cliente",
  "Contatto", "Telefono", "Tel.", "Tel. cliente", "E-mail", "Email", "Mail", "Preventivo", "Riferimento",
  "Riferimento cliente", "Indirizzo cliente", "Sede cliente", "Indirizzo", "Cantiere", "Luogo di intervento",
  "Luogo", "Sopralluogo", "Note accesso", "Accesso", "Vincoli", "CIG", "CUP", "Scadenza", "Consegna",
  "Fine lavori",
];

function isKnownFieldLine(line: string) {
  return INTAKE_LABELS.some((label) => new RegExp(`^\\s*${escapeRegex(label)}(?=\\s*(?:[:\\-–—]|$))`, "i").test(line));
}

function labeledBlockValue(source: string, labels: string[]) {
  const lines = source.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const pattern = labels.map(escapeRegex).join("|");
  const labelExpression = new RegExp(`^\\s*(?:${pattern})(?=\\s*(?:[:\\-–—]|$))\\s*(?:(?:[:\\-–—])\\s*)?(.*)$`, "i");

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(labelExpression);
    if (!match) continue;

    const values = match[1]?.trim() ? [match[1].trim()] : [];
    for (let nextIndex = index + 1; nextIndex < lines.length && values.length < 4; nextIndex += 1) {
      const nextLine = lines[nextIndex];
      if (isKnownFieldLine(nextLine) || /^(?:totale|imponibile|iva|condizioni|pagamento|validità|validita|note legali)\b/i.test(nextLine)) break;
      values.push(nextLine);
    }
    if (values.length) return values.join(" ");
  }
  return "";
}

function compactText(value: string, max = 900) {
  return value.replace(/\s+/g, " ").replace(/\s+([,.;:])/g, "$1").trim().slice(0, max);
}

function extractWorkLines(source: string, excluded: string[]) {
  const excludedSet = new Set(excluded.map((value) => compactText(value, 900).toLocaleLowerCase("it-IT")));
  return source.split(/\r?\n/)
    .map((line) => compactText(line, 260).replace(/^[•·▪◦*-]\s*/, ""))
    .filter((line) => line.length >= 14)
    .filter((line) => !excludedSet.has(line.toLocaleLowerCase("it-IT")))
    .filter((line) => !isKnownFieldLine(line))
    .filter((line) => !/^(?:preventivo|offerta|cliente|committente|ragione sociale|p\.?\s*iva|partita iva|codice fiscale|referente|telefono|tel\.?|e-?mail|mail|indirizzo|cantiere|luogo|sopralluogo|scadenza|consegna|fine lavori|cig|cup|totale|imponibile|iva|condizioni|pagamento|validità|validita|firma|data)\b/i.test(line))
    .filter((line) => !/^[\d\s.,€%/:+()\-]+$/.test(line))
    .slice(0, 4);
}

function buildStructuredDescription({
  title,
  rawDescription,
  client,
  worksite,
  source,
}: {
  title: string;
  rawDescription: string;
  client: string;
  worksite: string;
  source: string;
}) {
  const workLines = extractWorkLines(source, [title, rawDescription, client, worksite]);
  const workSummary = compactText(rawDescription || workLines.join("; "));
  const parts: string[] = [];
  if (workSummary) parts.push(`Lavorazioni rilevate: ${workSummary}${/[.!?]$/.test(workSummary) ? "" : "."}`);
  else if (title) parts.push(`Intervento: ${compactText(title, 180)}${/[.!?]$/.test(title) ? "" : "."}`);
  if (client) parts.push(`Committente: ${compactText(client, 180)}${/[.!?]$/.test(client) ? "" : "."}`);
  if (worksite) parts.push(`Luogo di intervento: ${compactText(worksite, 240)}${/[.!?]$/.test(worksite) ? "" : "."}`);
  return {
    value: parts.join(" ").slice(0, 2_000),
    confidence: rawDescription ? 0.91 : workLines.length ? 0.78 : title ? 0.68 : 0.42,
    source: rawDescription ? "Preventivo · descrizione" : workLines.length ? "Company AI · sintesi lavorazioni" : "Company AI · sintesi campi rilevati",
  };
}

function addSuggestion(
  suggestions: IntakeSuggestion[],
  key: keyof IntakeDraft,
  value: string,
  confidence: number,
  source: string,
) {
  const trimmed = value.trim();
  if (!trimmed) return;
  suggestions.push({ key, label: INTAKE_FIELD_LABELS[key], value: trimmed, confidence, source });
}

function upsertSuggestion(
  suggestions: IntakeSuggestion[],
  key: keyof IntakeDraft,
  value: string,
  confidence: number,
  source: string,
) {
  const trimmed = value.trim();
  if (!trimmed) return;
  const next = { key, label: INTAKE_FIELD_LABELS[key], value: trimmed, confidence, source };
  const index = suggestions.findIndex((suggestion) => suggestion.key === key);
  if (index === -1) suggestions.push(next);
  else suggestions[index] = next;
}

function setDraftField(draft: Partial<IntakeDraft>, key: keyof IntakeDraft, value: string) {
  Object.assign(draft, { [key]: value });
}

function mergeOpenAiExtraction({
  baseDraft,
  baseSuggestions,
  baseScopeSuggestion,
  baseKnowledgeHints,
  result,
}: {
  baseDraft: Partial<IntakeDraft>;
  baseSuggestions: IntakeSuggestion[];
  baseScopeSuggestion: CompanyAiScopeSuggestion;
  baseKnowledgeHints: ReturnType<typeof searchCompanyAiKnowledge>;
  result: NonNullable<Awaited<ReturnType<typeof analyzeCompanyAiWithOpenAi>>>["result"];
}) {
  const extraction = result!.extraction;
  const confidence = Math.min(0.98, Math.max(0.56, extraction.confidence || 0.7));
  const source = `OpenAI · ${result!.model}`;
  const draft: Partial<IntakeDraft> = { ...baseDraft };
  const suggestions = [...baseSuggestions];
  const fields: Array<[keyof IntakeDraft, string]> = [
    ["title", extraction.title],
    ["description", extraction.description],
    ["clientName", extraction.clientName],
    ["clientTaxId", extraction.clientTaxId],
    ["clientContact", extraction.clientContact],
    ["clientPhone", extraction.clientPhone],
    ["clientEmail", extraction.clientEmail],
    ["clientReference", extraction.clientReference],
    ["clientAddress", extraction.clientAddress],
    ["worksite", extraction.worksite],
    ["accessNotes", extraction.accessNotes],
    ["cig", extraction.cig],
    ["cup", extraction.cup],
    ["dueDate", extraction.dueDate],
  ];
  for (const [key, value] of fields) {
    if (!value) continue;
    setDraftField(draft, key, value);
    upsertSuggestion(suggestions, key, value, confidence, source);
  }
  if (extraction.openingType) {
    setDraftField(draft, "openingType", extraction.openingType);
    upsertSuggestion(suggestions, "openingType", extraction.openingType, confidence, source);
  }
  if (extraction.priority) {
    setDraftField(draft, "priority", extraction.priority);
    upsertSuggestion(suggestions, "priority", extraction.priority, confidence, source);
  }

  const aiSelection = resolveOpenAiScope(extraction);
  const deterministicSelection = baseScopeSuggestion.selection;
  const selectedScope = deterministicSelection && baseScopeSuggestion.score >= 0.82
    ? deterministicSelection
    : aiSelection ?? deterministicSelection;
  let scopeSuggestion = baseScopeSuggestion;
  let knowledgeHints = baseKnowledgeHints;
  if (selectedScope) {
    const scopeFields = scopeSelectionToFields(selectedScope);
    Object.assign(draft, scopeFields);
    const scopeScore = deterministicSelection === selectedScope
      ? Math.max(baseScopeSuggestion.score, confidence)
      : confidence;
    const matchedSignals = [...new Set([
      ...(baseScopeSuggestion.matchedSignals ?? []),
      ...extraction.evidence.map((signal) => `OpenAI: ${signal}`),
    ])].slice(0, 8);
    knowledgeHints = searchCompanyAiKnowledgeForScope(selectedScope, 6);
    scopeSuggestion = {
      selection: selectedScope,
      score: scopeScore,
      source: "company-ai",
      knowledgeHints,
      matchedSignals,
    };
    upsertSuggestion(suggestions, "scopeSectionId", selectedScope.sectionTitle, scopeScore, source);
    upsertSuggestion(suggestions, "scopeGroupId", selectedScope.groupTitle, scopeScore, source);
    upsertSuggestion(suggestions, "scopeSubgroupId", selectedScope.subgroupTitle, scopeScore, source);
  }
  return { draft, suggestions, scopeSuggestion, knowledgeHints };
}

function extractDraft(sourceText: string): { draft: Partial<IntakeDraft>; suggestions: IntakeSuggestion[]; scopeSuggestion: CompanyAiScopeSuggestion } {
  const source = sourceText.trim();
  const suggestions: IntakeSuggestion[] = [];
  const firstLine = source.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
  const rawTitle = labeledValue(source, ["Titolo", "Oggetto", "Commessa", "Lavori"]);
  const rawDescription = labeledBlockValue(source, ["Descrizione", "Descrizione lavori", "Oggetto lavori", "Lavorazioni", "Prestazioni", "Intervento", "Perimetro", "Note operative"]);
  const rawClient = labeledValue(source, ["Cliente", "Committente", "Ragione sociale"]);
  const rawTaxId = labeledValue(source, ["P. IVA", "PIVA", "Partita IVA", "Codice fiscale"]);
  const rawContact = labeledValue(source, ["Referente", "Referente cliente", "Contatto"]);
  const rawPhone = labeledValue(source, ["Telefono", "Tel.", "Tel. cliente"]);
  const rawEmail = labeledValue(source, ["E-mail", "Email", "Mail"]);
  const rawReference = labeledValue(source, ["Preventivo", "Riferimento", "Riferimento cliente"]);
  const rawClientAddress = labeledValue(source, ["Indirizzo cliente", "Sede cliente", "Indirizzo"]);
  const rawWorksite = labeledValue(source, ["Cantiere", "Luogo di intervento", "Luogo", "Sopralluogo"]);
  const rawAccessNotes = labeledValue(source, ["Note accesso", "Accesso", "Vincoli"]);
  const rawCig = labeledValue(source, ["CIG"]);
  const rawCup = labeledValue(source, ["CUP"]);
  const rawDueDate = labeledValue(source, ["Scadenza", "Consegna", "Fine lavori"]);

  const title = rawTitle || (firstLine && !firstLine.includes(":" ) ? firstLine : "");
  const structuredDescription = buildStructuredDescription({ title, rawDescription, client: rawClient, worksite: rawWorksite, source });
  const description = structuredDescription.value;
  const lowerSource = source.toLocaleLowerCase("it-IT");
  const openingType = /pronto intervento|urgenza|urgente|guasto|riparazione urgente|intervento immediato/.test(lowerSource) ? "PRONTO_INTERVENTO" : "NUOVA_COMMESSA";
  const inferredScope = inferCompanyAiScopeSelection(source);
  const scopeFields = scopeSelectionToFields(inferredScope?.selection ?? null);
  const scopeSuggestion: CompanyAiScopeSuggestion = {
    selection: inferredScope?.selection ?? null,
    score: inferredScope?.score ?? 0,
    source: "company-ai",
    knowledgeHints: inferredScope?.selection ? searchCompanyAiKnowledgeForScope(inferredScope.selection, 6) : [],
    matchedSignals: inferredScope?.matchedSignals ?? [],
  };

  addSuggestion(suggestions, "title", title, rawTitle ? 0.96 : 0.52, rawTitle ? "Preventivo · oggetto" : "Prima riga del documento");
  addSuggestion(suggestions, "description", description, structuredDescription.confidence, structuredDescription.source);
  addSuggestion(suggestions, "openingType", openingType, /pronto intervento|urgenza|urgente|guasto|riparazione urgente|intervento immediato/.test(lowerSource) ? 0.94 : 0.74, "Classificazione del documento");
  if (inferredScope?.selection) {
    addSuggestion(suggestions, "scopeSectionId", inferredScope.selection.sectionTitle, scopeSuggestion.score, "Company AI · sezione");
    addSuggestion(suggestions, "scopeGroupId", inferredScope.selection.groupTitle, scopeSuggestion.score, "Company AI · raggruppamento");
    addSuggestion(suggestions, "scopeSubgroupId", inferredScope.selection.subgroupTitle, scopeSuggestion.score, "Company AI · sottogruppo");
  }
  addSuggestion(suggestions, "clientName", rawClient, 0.96, "Preventivo · cliente");
  addSuggestion(suggestions, "clientTaxId", rawTaxId, 0.98, "Preventivo · identificativo fiscale");
  addSuggestion(suggestions, "clientContact", rawContact, 0.9, "Preventivo · referente");
  addSuggestion(suggestions, "clientPhone", rawPhone, 0.9, "Preventivo · telefono");
  addSuggestion(suggestions, "clientEmail", rawEmail, 0.94, "Preventivo · e-mail");
  addSuggestion(suggestions, "clientReference", rawReference, 0.93, "Preventivo · riferimento");
  addSuggestion(suggestions, "clientAddress", rawClientAddress, 0.87, "Preventivo · sede cliente");
  addSuggestion(suggestions, "worksite", rawWorksite, 0.93, "Preventivo · cantiere");
  addSuggestion(suggestions, "accessNotes", rawAccessNotes, 0.82, "Preventivo · note operative");
  addSuggestion(suggestions, "cig", rawCig, 0.98, "Preventivo · CIG");
  addSuggestion(suggestions, "cup", rawCup, 0.98, "Preventivo · CUP");
  addSuggestion(suggestions, "dueDate", rawDueDate, 0.88, "Preventivo · scadenza");

  const draft: Partial<IntakeDraft> = {
    ...DEFAULT_INTAKE_DRAFT,
    title: title.slice(0, 120),
    statusCode: "DRAFT",
    openingType,
    ...scopeFields,
    description: description.slice(0, 2_000),
    clientName: rawClient.slice(0, 160),
    clientTaxId: rawTaxId.slice(0, 80),
    clientContact: rawContact.slice(0, 120),
    clientPhone: rawPhone.slice(0, 80),
    clientEmail: rawEmail.slice(0, 160),
    clientReference: rawReference.slice(0, 160),
    clientAddress: rawClientAddress.slice(0, 240),
    worksite: rawWorksite.slice(0, 240),
    accessNotes: rawAccessNotes.slice(0, 2_000),
    cig: rawCig.slice(0, 80),
    cup: rawCup.slice(0, 80),
    dueDate: rawDueDate.slice(0, 40),
  };
  return { draft, suggestions, scopeSuggestion };
}

export async function POST(request: Request) {
  const context = await getS07Context();
  const denied = s07AccessDenied(context, "write");
  if (denied) return denied;

  let input: Record<string, unknown>;
  try {
    const parsed = await request.json() as unknown;
    if (!isRecord(parsed)) return Response.json({ error: "invalid_json" }, { status: 400 });
    input = parsed;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const sourceText = bounded(input.sourceText, MAX_INTAKE_SOURCE_CHARS);
  const sourceName = bounded(input.sourceName, 160);
  const requestedIdempotencyKey = bounded(input.idempotencyKey, 160);
  if (sourceText.length < 2) return Response.json({ error: "source_text_required" }, { status: 400 });
  if (typeof input.idempotencyKey === "string" && input.idempotencyKey.trim().length > 160) {
    return Response.json({ error: "idempotency_key_too_long" }, { status: 400 });
  }

  const { draft, suggestions, scopeSuggestion } = extractDraft(sourceText);
  const knowledgePack = getCompanyAiKnowledgePackSummary();
  const knowledgeHints = scopeSuggestion.selection
    ? searchCompanyAiKnowledgeForScope(scopeSuggestion.selection, 6)
    : searchCompanyAiKnowledge(sourceText, { limit: 6 });
  const previewId = crypto.randomUUID();
  const idempotencyKey = requestedIdempotencyKey || `s07:intake:${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const mode: IntakeMode = "COMPANY_AI";
  try {
    const db = getDb();
    const existingEvent = await db.select().from(s06Events).where(and(
      eq(s06Events.tenantId, context!.tenantId),
      eq(s06Events.idempotencyKey, idempotencyKey),
    )).limit(1);
    if (existingEvent[0]) {
      if (existingEvent[0].aggregateType !== "s07.intake.preview") {
        return Response.json({ error: "company_ai_intake_idempotency_key_conflict" }, { status: 409 });
      }
      const [existingPreview] = await db.select().from(s07AiLedger).where(and(
        eq(s07AiLedger.tenantId, context!.tenantId),
        eq(s07AiLedger.id, existingEvent[0].aggregateId),
      )).limit(1);
      if (!existingPreview) return Response.json({ error: "company_ai_preview_readback_unavailable" }, { status: 503 });
      const stored = parseObject(existingPreview.payloadJson);
      return Response.json({
        previewId: existingPreview.id,
        mode: "COMPANY_AI",
        directWrite: false,
        runtime: "governed-intake-preview",
        sourceName: text(stored.sourceName) || undefined,
        draft: isRecord(stored.draft) ? stored.draft : {},
        suggestions: Array.isArray(stored.suggestions) ? stored.suggestions : [],
        scopeSuggestion: isRecord(stored.scopeSuggestion) ? stored.scopeSuggestion : undefined,
        knowledgePack,
        knowledgeHints: Array.isArray(stored.knowledgeHints) ? stored.knowledgeHints : [],
        readback: { status: "SITES_LEDGER_VERIFIED", checkedAt: existingPreview.createdAt },
        idempotent: true,
      }, { headers: { "cache-control": "no-store" } });
    }

    const aiOutcome = await analyzeCompanyAiWithOpenAi({
      sourceText,
      sourceName,
      knowledgePack,
      knowledgeHints,
    });
    const merged = aiOutcome.result
      ? mergeOpenAiExtraction({
        baseDraft: draft,
        baseSuggestions: suggestions,
        baseScopeSuggestion: scopeSuggestion,
        baseKnowledgeHints: knowledgeHints,
        result: aiOutcome.result,
      })
      : { draft, suggestions, scopeSuggestion, knowledgeHints };
    const resolvedDraft = merged.draft;
    const resolvedSuggestions = merged.suggestions;
    const resolvedScopeSuggestion = merged.scopeSuggestion;
    const resolvedKnowledgeHints = merged.knowledgeHints;
    const runtime = aiOutcome.result ? "openai-responses-governed-preview" : "governed-intake-preview-fallback";
    const aiRuntime = {
      provider: "openai",
      status: aiOutcome.status,
      model: aiOutcome.model,
      requestId: aiOutcome.result?.requestId ?? null,
    };
    const eventId = crypto.randomUUID();
    const previewPayload = {
        source: "company-ai",
        mode,
        directWrite: false,
        runtime,
        aiRuntime,
        sourceName,
        idempotencyKey,
        draft: resolvedDraft,
        suggestions: resolvedSuggestions,
        scopeSuggestion: resolvedScopeSuggestion,
        knowledgePackId: knowledgePack.id,
        knowledgePackVersion: knowledgePack.version,
        knowledgeHintIds: resolvedKnowledgeHints.map((hint) => hint.id),
        knowledgeHints: resolvedKnowledgeHints,
      };
    const serializedPreview = JSON.stringify(previewPayload);
    if (serializedPreview.length > 12_000) return Response.json({ error: "preview_payload_too_large" }, { status: 413 });

    await db.batch([
      db.insert(s07AiLedger).values({
        id: previewId,
        tenantId: context!.tenantId,
        entryType: "commessa_intake_preview",
        actionType: "operations.commessa_intake",
        command: sourceName ? `Crea una commessa dal documento ${sourceName}` : "Crea una commessa dal preventivo fornito",
        status: "PREVIEW_ONLY",
        approvalRequired: 0,
        relatedActionId: null,
        payloadJson: serializedPreview,
        requestedBy: context!.actorId,
        approvedBy: null,
        readbackJson: JSON.stringify({ status: "SITES_LEDGER_VERIFIED", checkedAt: now }),
        createdAt: now,
      }),
      db.insert(s06Events).values({
        eventId,
        tenantId: context!.tenantId,
        eventType: "company_ai.intake.previewed",
        schemaVersion: "1",
        actorType: "human",
        actorId: context!.actorId,
        source: "sites-command",
        occurredAt: now,
        observedAt: now,
        aggregateType: "s07.intake.preview",
        aggregateId: previewId,
        aggregateVersion: 1,
        payloadJson: JSON.stringify({ sourceName, mode, scopeSubgroupId: resolvedScopeSuggestion.selection?.subgroupId ?? null, runtime, aiStatus: aiOutcome.status, source: "company-ai" }),
        correlationId: crypto.randomUUID(),
        causationId: null,
        idempotencyKey,
        status: "COMMITTED_SITES_READBACK",
        createdAt: now,
      }),
      db.insert(s06Outbox).values({
        id: crypto.randomUUID(),
        tenantId: context!.tenantId,
        eventId,
        topic: "zerow.company_ai.intake.previewed",
        status: "PENDING_EXTERNAL_CONSUMER",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(s06Reconciliations).values({
        id: crypto.randomUUID(),
        tenantId: context!.tenantId,
        aggregateType: "s07.intake.preview",
        aggregateId: previewId,
        expectedVersion: 1,
        observedVersion: 1,
        status: "SITES_READBACK_VERIFIED",
        detail: "Preview Company AI e relativo event boundary persistiti nello stesso commit D1; nessuna commessa è stata scritta.",
        createdAt: now,
        updatedAt: now,
      }),
    ]);
    const [readback] = await db.select().from(s07AiLedger).where(and(
      eq(s07AiLedger.tenantId, context!.tenantId),
      eq(s07AiLedger.id, previewId),
    )).limit(1);
    if (!readback) return Response.json({ error: "company_ai_preview_readback_unavailable" }, { status: 503 });
    return Response.json({
      previewId,
      mode,
      directWrite: false,
      runtime,
      aiRuntime,
      sourceName: sourceName || undefined,
      draft: resolvedDraft,
      suggestions: resolvedSuggestions,
      scopeSuggestion: resolvedScopeSuggestion,
      knowledgePack,
      knowledgeHints: resolvedKnowledgeHints,
      readback: { status: "SITES_LEDGER_VERIFIED", checkedAt: now },
      idempotent: false,
    }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE") || message.includes("unique")) {
      return Response.json({ error: "company_ai_preview_idempotency_conflict" }, { status: 409 });
    }
    return Response.json({ error: "company_ai_preview_unavailable" }, { status: 503 });
  }
}
