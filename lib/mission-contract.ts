import { missionPodEvidenceComplete, missionPodEvidenceLabel } from "@/lib/mission-pod-contract";
import { missionExceptionIsOpen, missionExceptionLabel, storedMissionException } from "@/lib/mission-exception-contract";

export type MissionReportStatus = "EMPTY" | "DRAFT" | "SUBMITTED" | "APPROVED" | "CHANGES_REQUESTED";
export type MissionReportReviewStatus = "PENDING" | "APPROVED" | "CHANGES_REQUESTED";
export type MissionReportFieldStatus = "known" | "missing" | "optional";

export type MissionReportField = {
  key: string;
  label: string;
  value: string;
  status: MissionReportFieldStatus;
  source: string;
};

export type MissionReportCompleteness = {
  ready: boolean;
  missing: string[];
  questions: string[];
};

export type MissionReportReview = {
  status: MissionReportReviewStatus;
  note: string;
  reviewedAt: string;
  reviewedBy: string;
};

export type MissionReportReadback = {
  status: MissionReportStatus;
  draft: string;
  fields: MissionReportField[];
  timeline: Array<Record<string, unknown>>;
  completeness: MissionReportCompleteness;
  review: MissionReportReview;
};

type JsonObject = Record<string, unknown>;

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function parseStatus(value: unknown): MissionReportStatus {
  const status = text(value).toUpperCase();
  if (status === "APPROVED") return "APPROVED";
  if (status === "CHANGES_REQUESTED") return "CHANGES_REQUESTED";
  if (status === "SUBMITTED") return "SUBMITTED";
  if (status === "DRAFT") return "DRAFT";
  return "EMPTY";
}

function recordAt(value: unknown, key: string) {
  return isRecord(value) ? value[key] : undefined;
}

function cargoAssetRecords(payload: JsonObject) {
  const snapshot = isRecord(payload.resourceSnapshot) ? payload.resourceSnapshot : {};
  const records = Array.isArray(snapshot.cargoAssets)
    ? snapshot.cargoAssets.filter((value): value is JsonObject => isRecord(value))
    : [];
  if (records.length) return records;
  const legacy = recordAt(snapshot, "cargoAsset");
  return isRecord(legacy) ? [legacy] : [];
}

function cargoAssetLabels(payload: JsonObject) {
  const records = cargoAssetRecords(payload);
  return records.map((record) => {
    const code = text(record.code);
    const label = text(record.label, "Asset");
    return code && code !== label ? `${code} · ${label}` : label;
  });
}

function routeStops(payload: JsonObject) {
  const route = isRecord(payload.route) ? payload.route : {};
  const readback = isRecord(payload.routeReadback) ? payload.routeReadback : {};
  const planned = Array.isArray(route.stops) ? route.stops : [];
  const observed = Array.isArray(readback.stops) ? readback.stops : [];
  const source = observed.length ? observed : planned;
  return source.flatMap((candidate, index) => {
    if (!isRecord(candidate)) return [];
    const plannedStop = planned.find((item) => isRecord(item) && text(item.id) === text(candidate.id));
    const plannedValue = isRecord(plannedStop) ? plannedStop : {};
    const metadata = isRecord(candidate.metadata) ? candidate.metadata : {};
    const rawActions = Array.isArray(plannedValue.cargoActions)
      ? plannedValue.cargoActions
      : Array.isArray(metadata.cargoActions) ? metadata.cargoActions : [];
    const cargoActions = rawActions.flatMap((action) => {
      if (typeof action === "string") return [{ action: action.toUpperCase() }];
      if (!isRecord(action)) return [];
      const normalized = text(action.action ?? action.type).toUpperCase();
      return normalized ? [{ action: normalized, assetId: text(action.assetId) || null, itemId: text(action.itemId) || null }] : [];
    });
    const kind = text(plannedValue.kind ?? metadata.kind, "TRANSFER").toUpperCase();
    const sequence = typeof candidate.sequence === "number"
      ? candidate.sequence
      : typeof plannedValue.sequence === "number" ? plannedValue.sequence : index + 1;
    return [{
      id: text(candidate.id ?? plannedValue.id, `STOP-${index + 1}`),
      sequence,
      kind,
      label: text(plannedValue.label ?? metadata.label, `Tappa ${sequence}`),
      cargoActions,
      deliveryEvidenceRequired: plannedValue.deliveryEvidenceRequired !== false
        && metadata.deliveryEvidenceRequired !== false
        && kind === "DELIVERY",
    }];
  });
}

function operationalTimeline(payload: JsonObject) {
  return Array.isArray(payload.operationalTimeline)
    ? payload.operationalTimeline.filter((entry): entry is JsonObject => isRecord(entry))
    : [];
}

function deliveryProofEntries(payload: JsonObject) {
  const entries = Array.isArray(payload.proofOfDeliveries)
    ? payload.proofOfDeliveries.filter((entry): entry is JsonObject => isRecord(entry))
    : [];
  if (entries.length) return entries;
  const legacy = isRecord(payload.proofOfDelivery) ? payload.proofOfDelivery : null;
  return legacy ? [legacy] : [];
}

function requiredEventTypes(action: string) {
  if (action === "LOAD") return ["LOAD_CONFIRMED"];
  if (action === "UNLOAD") return ["UNLOAD_CONFIRMED"];
  if (action === "RETURN") return ["UNLOAD_CONFIRMED", "LOAD_CONFIRMED"];
  return ["LOAD_CONFIRMED", "UNLOAD_CONFIRMED", "DELIVERY_CONFIRMED"];
}

function hasEventForStop(timeline: JsonObject[], stopId: string, action: string) {
  const accepted = new Set(requiredEventTypes(action));
  return timeline.some((event) => {
    const type = text(event.type).toUpperCase();
    if (!accepted.has(type)) return false;
    const eventStopId = text(event.stopId);
    return eventStopId === stopId || (!eventStopId && !stopId);
  });
}

function stopActionLines(stops: ReturnType<typeof routeStops>) {
  return stops.map((stop) => {
    const action = stop.cargoActions.map((item) => item.action).filter(Boolean).join(" + ") || "OPERATIVA";
    return `${stop.sequence}. ${stop.label} · ${action}`;
  });
}

function eventLines(timeline: JsonObject[]) {
  return timeline.slice(-12).map((event) => {
    const type = text(event.type, "EVENTO").replaceAll("_", " ");
    const at = text(event.recordedAt ?? event.occurredAt, "orario server");
    const note = text(event.note);
    return `${type} · ${at}${note ? ` · ${note}` : ""}`;
  });
}

export function buildMissionReportReadback(
  payload: JsonObject,
  options: { textOverride?: string } = {},
): MissionReportReadback {
  const saved = isRecord(payload.missionReport) ? payload.missionReport : {};
  const reportText = text(options.textOverride ?? saved.text);
  const stops = routeStops(payload);
  const timeline = operationalTimeline(payload);
  const proofEntries = deliveryProofEntries(payload);
  const latestProof = proofEntries.at(-1) ?? {};
  const missionException = storedMissionException(payload.missionException);
  const missing: string[] = [];
  const questions: string[] = [];

  if (!text(payload.title)) {
    missing.push("mission_identity");
    questions.push("Qual è il riferimento della missione da riportare in ufficio?");
  }
  if (!stops.length) {
    missing.push("route");
    questions.push("Quali tappe sono state effettuate? La missione non ha una rotta leggibile.");
  }
  for (const stop of stops) {
    const actions = stop.cargoActions.length ? stop.cargoActions : [{ action: stop.kind === "DELIVERY" ? "UNLOAD" : "LOAD" }];
    for (const action of actions) {
      if (!hasEventForStop(timeline, stop.id, action.action)) {
        missing.push(`stop_${stop.sequence}_${action.action.toLowerCase()}`);
        questions.push(`Conferma l’azione “${action.action.toLowerCase()}” alla tappa ${stop.sequence}: ${stop.label}.`);
      }
    }
  }

  const deliveryStops = stops.filter((stop) => stop.deliveryEvidenceRequired || stop.kind === "DELIVERY");
  const missingDeliveryProofStops = deliveryStops.filter((stop) => {
    const stopProof = proofEntries.find((entry) => text(entry.stopId) === stop.id)
      ?? (deliveryStops.length === 1 ? latestProof : null);
    return !stopProof
      || text(stopProof.recipient).length < 2
      || text(stopProof.deliveredAt).length < 10
      || !missionPodEvidenceComplete(stopProof.evidence);
  });
  if (missingDeliveryProofStops.length) {
    for (const stop of missingDeliveryProofStops) {
      missing.push(`delivery_evidence_${stop.sequence}`);
      questions.push(`Chi ha ricevuto la consegna alla tappa ${stop.sequence}: ${stop.label} e quale evidenza operativa la conferma? Registra DDT, firma, foto, QR oppure conferma autista.`);
    }
  }
  if (deliveryStops.length && !timeline.some((event) => text(event.type).toUpperCase() === "DELIVERY_CONFIRMED")) {
    missing.push("delivery_event");
    questions.push("Registra la conferma di consegna dalla tappa corretta prima di inviare il rapportino.");
  }
  const warehouseReadback = isRecord(payload.warehouseReadback) ? payload.warehouseReadback : null;
  const warehouseRequired = warehouseReadback?.required === true;
  const warehouseStatus = text(warehouseReadback?.status).toUpperCase();
  if (warehouseRequired && warehouseStatus !== "DELIVERED") {
    missing.push("warehouse_reconciliation");
    questions.push("Riconcilia nel registro del magazzino il prelievo, il carico e lo scarico di tutte le righe prima dell’invio.");
  }
  if (missionExceptionIsOpen(payload.missionException)) {
    missing.push("mission_exception_resolution");
    questions.push(`Risolvi l’eccezione “${missionExceptionLabel(missionException?.type)}”${missionException?.note ? `: ${missionException.note}` : ""} prima di inviare il rapportino.`);
  }
  if (reportText.length < 30 || reportText.includes("[da completare]")) {
    missing.push("narrative");
    questions.push("Descrivi l’esito della missione, eventuali anomalie e ciò che deve sapere l’ufficio.");
  }

  const driver = recordAt(payload.resourceSnapshot, "driver");
  const vehicle = recordAt(payload.resourceSnapshot, "vehicle");
  const cargoAssets = cargoAssetLabels(payload);
  const cargoLabel = cargoAssets.join(" · ") || text(payload.cargoAssetId, "nessun asset associato");
  const routeLines = stopActionLines(stops);
  const timelineLines = eventLines(timeline);
  const draft = reportText || [
    `Missione: ${text(payload.title, "da identificare")}`,
    `Autista: ${text(recordAt(driver, "label") ?? recordAt(driver, "code") ?? payload.driverId, "da verificare")}`,
    `Mezzo: ${text(recordAt(vehicle, "label") ?? recordAt(vehicle, "code") ?? payload.vehicleId, "da verificare")}`,
    `Asset/materiale: ${cargoLabel}`,
    `Tappe: ${routeLines.join(" | ") || "[da completare]"}`,
    `Eventi server: ${timelineLines.join(" | ") || "[da completare]"}`,
    ...(warehouseRequired ? [`Riconciliazione magazzino: ${warehouseStatus || "[da completare]"}`] : []),
    ...(missionException ? [`Eccezione missione: ${missionExceptionLabel(missionException.type)} · ${missionException.recoveryStatus}${missionException.note ? ` · ${missionException.note}` : ""}`] : []),
    `Ricevente: ${text(latestProof.recipient, "[da completare]")}`,
    "Esito e anomalie: [da completare]",
  ].join("\n");

  const fields: MissionReportField[] = [
    { key: "mission", label: "Missione", value: text(payload.title, "Identità non disponibile"), status: text(payload.title) ? "known" : "missing", source: "Registro missioni" },
    { key: "driver", label: "Autista", value: text(recordAt(driver, "label") ?? recordAt(driver, "code") ?? payload.driverId, "Non disponibile"), status: (driver || text(payload.driverId)) ? "known" : "missing", source: "Workforce / Planning" },
    { key: "vehicle", label: "Mezzo", value: text(recordAt(vehicle, "label") ?? recordAt(vehicle, "code") ?? payload.vehicleId, "Non disponibile"), status: (vehicle || text(payload.vehicleId)) ? "known" : "missing", source: "Asset / Planning" },
    { key: "cargo", label: "Asset o materiale", value: cargoAssets.length ? cargoLabel : "Nessun asset associato", status: cargoAssets.length || text(payload.cargoAssetId) ? "known" : "optional", source: "Asset / Magazzino" },
    { key: "route", label: "Tappe", value: routeLines.join(" · ") || "Nessuna tappa", status: stops.length ? "known" : "missing", source: "Route server-side" },
    { key: "actions", label: "Azioni registrate", value: timelineLines.join(" · ") || "Nessuna azione", status: timeline.length ? "known" : "missing", source: "Timeline server-side" },
    { key: "warehouse", label: "Riconciliazione magazzino", value: warehouseRequired ? (warehouseStatus || "Da completare") : "Non richiesta", status: !warehouseRequired || warehouseStatus === "DELIVERED" ? "known" : "missing", source: "Ledger Magazzino" },
    { key: "delivery", label: "Prova di consegna", value: proofEntries.length ? proofEntries.map((entry) => `${text(entry.recipient, "Ricevente non indicato")} · ${missionPodEvidenceLabel(isRecord(entry.evidence) ? entry.evidence.type : null)}`).join(" | ") : "Da completare", status: !deliveryStops.length || !missingDeliveryProofStops.length ? "known" : "missing", source: "POD / Autista" },
    { key: "exception", label: "Eccezioni e recupero", value: missionException ? `${missionExceptionLabel(missionException.type)} · ${missionException.recoveryStatus}` : "Nessuna eccezione aperta", status: !missionException || missionException.recoveryStatus === "RESOLVED" ? "known" : "missing", source: "Timeline missione" },
    { key: "narrative", label: "Esito e anomalie", value: reportText || "Da completare", status: reportText.length >= 30 && !reportText.includes("[da completare]") ? "known" : "missing", source: "Company AI / Autista" },
  ];

  const status = parseStatus(saved.status);
  const reviewStatus: MissionReportReviewStatus = status === "APPROVED"
    ? "APPROVED"
    : status === "CHANGES_REQUESTED"
      ? "CHANGES_REQUESTED"
      : "PENDING";

  return {
    status,
    draft,
    fields,
    timeline: timeline.slice(-20).reverse(),
    completeness: { ready: missing.length === 0, missing, questions },
    review: {
      status: reviewStatus,
      note: text(saved.reviewNote),
      reviewedAt: text(saved.reviewedAt),
      reviewedBy: text(saved.reviewedBy),
    },
  };
}
