import { getDb } from "@/db";
import { s07AiLedger } from "@/db/schema";
import {
  getS07Context,
  getS07Ledger,
  s07AccessDenied,
} from "@/lib/s07-adapter";
import {
  DEFAULT_INTAKE_DRAFT,
  INTAKE_FIELD_LABELS,
  type IntakeDraft,
  type IntakeMode,
  type IntakeSuggestion,
} from "@/lib/operations-intake";

export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function bounded(value: unknown, max: number, fallback = "") {
  return text(value, fallback).slice(0, max);
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

function normalizedCategory(value: string) {
  const lower = value.toLowerCase();
  if (lower.includes("trasport") || lower.includes("logistic")) return "Logistica e trasporti";
  if (lower.includes("impiant") || lower.includes("manutenz")) return "Impianti e manutenzione";
  if (lower.includes("serviz")) return "Servizi tecnici";
  if (lower.includes("edil") || lower.includes("ristruttur") || lower.includes("cantiere")) return "Edilizia e ristrutturazioni";
  return value;
}

function normalizedSpecialization(value: string) {
  const lower = value.toLowerCase();
  if (lower.includes("sopral") || lower.includes("riliev")) return "Sopralluogo e rilievo";
  if (lower.includes("straordin")) return "Manutenzione straordinaria";
  if (lower.includes("manutenz")) return "Manutenzione ordinaria";
  if (lower.includes("install") || lower.includes("collaud")) return "Installazione e collaudo";
  if (lower.includes("ristruttur")) return "Ristrutturazione interna";
  return value;
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

function extractDraft(sourceText: string): { draft: Partial<IntakeDraft>; suggestions: IntakeSuggestion[] } {
  const source = sourceText.trim();
  const suggestions: IntakeSuggestion[] = [];
  const firstLine = source.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
  const rawTitle = labeledValue(source, ["Titolo", "Oggetto", "Commessa", "Lavori"]);
  const rawDescription = labeledValue(source, ["Descrizione", "Oggetto lavori", "Perimetro", "Note operative"]);
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
  const rawJobType = labeledValue(source, ["Tipo di commessa", "Categoria", "Lavorazione"]);
  const rawSpecialization = labeledValue(source, ["Specializzazione", "Tipologia"]);

  const title = rawTitle || (firstLine && !firstLine.includes(":" ) ? firstLine : "");
  const description = rawDescription || source;
  const jobType = normalizedCategory(rawJobType || (source.toLowerCase().includes("ristruttur") ? "Edilizia e ristrutturazioni" : ""));
  const specialization = normalizedSpecialization(rawSpecialization || (source.toLowerCase().includes("ristruttur") ? "Ristrutturazione interna" : ""));
  const openingType = source.toLowerCase().includes("preventivo") ? "PREVENTIVO_APPROVATO" : "NUOVA_COMMESSA";

  addSuggestion(suggestions, "title", title, rawTitle ? 0.96 : 0.52, rawTitle ? "Preventivo · oggetto" : "Prima riga del documento");
  addSuggestion(suggestions, "description", description, rawDescription ? 0.91 : 0.64, rawDescription ? "Preventivo · descrizione" : "Contenuto del documento");
  addSuggestion(suggestions, "openingType", openingType, 0.72, "Segnale preventivo nel documento");
  addSuggestion(suggestions, "jobType", jobType, rawJobType ? 0.9 : 0.58, rawJobType ? "Preventivo · classificazione" : "Classificazione testuale");
  addSuggestion(suggestions, "specialization", specialization, rawSpecialization ? 0.9 : 0.58, rawSpecialization ? "Preventivo · tipologia" : "Classificazione testuale");
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
    jobType: jobType || DEFAULT_INTAKE_DRAFT.jobType,
    specialization: specialization || DEFAULT_INTAKE_DRAFT.specialization,
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
  return { draft, suggestions };
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

  const sourceText = bounded(input.sourceText, 20_000);
  const sourceName = bounded(input.sourceName, 160);
  if (sourceText.length < 2) return Response.json({ error: "source_text_required" }, { status: 400 });

  const { draft, suggestions } = extractDraft(sourceText);
  const previewId = crypto.randomUUID();
  const now = new Date().toISOString();
  const mode: IntakeMode = "COMPANY_AI";
  try {
    const db = getDb();
    await db.insert(s07AiLedger).values({
      id: previewId,
      tenantId: context!.tenantId,
      entryType: "commessa_intake_preview",
      actionType: "operations.commessa_intake",
      command: sourceName ? `Crea una commessa dal documento ${sourceName}` : "Crea una commessa dal preventivo fornito",
      status: "PREVIEW_ONLY",
      approvalRequired: 0,
      relatedActionId: null,
      payloadJson: JSON.stringify({
        source: "company-ai",
        mode,
        directWrite: false,
        runtime: "governed-intake-preview",
        sourceName,
        draft,
        suggestions,
      }),
      requestedBy: context!.actorId,
      approvedBy: null,
      readbackJson: JSON.stringify({ status: "SITES_LEDGER_VERIFIED", checkedAt: now }),
      createdAt: now,
    });
    await getS07Ledger(context!.tenantId);
    return Response.json({
      previewId,
      mode,
      directWrite: false,
      runtime: "governed-intake-preview",
      sourceName: sourceName || undefined,
      draft,
      suggestions,
      readback: { status: "SITES_LEDGER_VERIFIED", checkedAt: now },
    }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "company_ai_preview_unavailable" }, { status: 503 });
  }
}
