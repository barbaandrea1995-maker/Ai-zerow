export type PlanningResourceKind = "person" | "team" | "asset" | "vehicle";

export type PlanningInterval = {
  startsAt: string;
  endsAt: string;
};

export type PlanningResource = {
  id: string;
  kind: PlanningResourceKind;
  label: string;
  capacity: number;
  qualifications: string[];
  unavailable: PlanningInterval[];
};

export type PlanningSlot = {
  id: string;
  startsAt: string;
  endsAt: string;
  resourceIds: string[];
  requiredQualifications: string[];
  workload: number;
};

export type PlanningConflictCode =
  | "INVALID_INTERVAL"
  | "RESOURCE_OVERLAP"
  | "RESOURCE_UNAVAILABLE"
  | "CAPACITY_EXCEEDED"
  | "QUALIFICATION_MISSING";

export type PlanningConflict = {
  code: PlanningConflictCode;
  slotIds: string[];
  resourceId?: string;
  detail: string;
};

export type PlanningEvaluation = {
  feasible: boolean;
  conflicts: PlanningConflict[];
  checkedAt: string;
};

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function finitePositive(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function uniqueStrings(value: unknown, max: number) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, 120))
    .filter(Boolean))].slice(0, max);
}

function validInterval(interval: PlanningInterval) {
  const starts = Date.parse(interval.startsAt);
  const ends = Date.parse(interval.endsAt);
  return Number.isFinite(starts) && Number.isFinite(ends) && ends > starts;
}

function overlaps(left: PlanningInterval, right: PlanningInterval) {
  return Date.parse(left.startsAt) < Date.parse(right.endsAt)
    && Date.parse(right.startsAt) < Date.parse(left.endsAt);
}

export function normalizePlanningResource(value: unknown, index = 0): PlanningResource | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const id = text(candidate.id).slice(0, 120);
  if (!id) return null;
  const rawKind = text(candidate.kind, "person");
  const kind: PlanningResourceKind = rawKind === "team" || rawKind === "asset" || rawKind === "vehicle"
    ? rawKind
    : "person";
  const unavailable = Array.isArray(candidate.unavailable)
    ? candidate.unavailable.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const interval = item as Record<string, unknown>;
      return {
        startsAt: text(interval.startsAt),
        endsAt: text(interval.endsAt),
      } satisfies PlanningInterval;
    }).filter((item): item is PlanningInterval => Boolean(item?.startsAt && item?.endsAt))
    : [];
  return {
    id,
    kind,
    label: text(candidate.label, `Risorsa ${index + 1}`).slice(0, 160),
    capacity: Math.min(100, finitePositive(candidate.capacity, 1)),
    qualifications: uniqueStrings(candidate.qualifications, 32),
    unavailable: unavailable.slice(0, 32),
  };
}

export function normalizePlanningSlot(value: unknown, index = 0): PlanningSlot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const startsAt = text(candidate.startsAt);
  const endsAt = text(candidate.endsAt);
  const resourceIds = uniqueStrings(candidate.resourceIds, 32);
  if (!startsAt || !endsAt || !resourceIds.length) return null;
  return {
    id: text(candidate.id, `slot-${index + 1}`).slice(0, 120),
    startsAt,
    endsAt,
    resourceIds,
    requiredQualifications: uniqueStrings(candidate.requiredQualifications ?? candidate.qualifications, 32),
    workload: Math.min(100, finitePositive(candidate.workload, 1)),
  };
}

function addConflict(conflicts: PlanningConflict[], candidate: PlanningConflict) {
  const key = [candidate.code, candidate.resourceId ?? "", ...candidate.slotIds].sort().join("|");
  if (!conflicts.some((item) => [item.code, item.resourceId ?? "", ...item.slotIds].sort().join("|") === key)) {
    conflicts.push(candidate);
  }
}

export function evaluatePlanning(
  slots: PlanningSlot[],
  resources: PlanningResource[],
): PlanningEvaluation {
  const conflicts: PlanningConflict[] = [];
  const resourcesById = new Map(resources.map((resource) => [resource.id, resource]));

  for (const slot of slots) {
    if (!validInterval(slot)) {
      addConflict(conflicts, {
        code: "INVALID_INTERVAL",
        slotIds: [slot.id],
        detail: "La finestra della lavorazione deve avere inizio e fine validi.",
      });
      continue;
    }
    for (const resourceId of slot.resourceIds) {
      const resource = resourcesById.get(resourceId);
      if (!resource) {
        addConflict(conflicts, {
          code: "RESOURCE_UNAVAILABLE",
          slotIds: [slot.id],
          resourceId,
          detail: "La risorsa richiesta non è presente nel perimetro di pianificazione.",
        });
        continue;
      }
      if (resource.unavailable.some((interval) => validInterval(interval) && overlaps(slot, interval))) {
        addConflict(conflicts, {
          code: "RESOURCE_UNAVAILABLE",
          slotIds: [slot.id],
          resourceId,
          detail: `${resource.label} non è disponibile nella finestra richiesta.`,
        });
      }
      const missing = slot.requiredQualifications.filter((qualification) => !resource.qualifications.includes(qualification));
      if (missing.length) {
        addConflict(conflicts, {
          code: "QUALIFICATION_MISSING",
          slotIds: [slot.id],
          resourceId,
          detail: `${resource.label} non possiede: ${missing.join(", ")}.`,
        });
      }
      const overlapping = slots.filter((other) => other.id !== slot.id
        && other.resourceIds.includes(resourceId)
        && validInterval(other)
        && overlaps(slot, other));
      const workload = slot.workload + overlapping.reduce((sum, other) => sum + other.workload, 0);
      if (workload > resource.capacity) {
        addConflict(conflicts, {
          code: resource.capacity <= 1 ? "RESOURCE_OVERLAP" : "CAPACITY_EXCEEDED",
          slotIds: [slot.id, ...overlapping.map((other) => other.id)],
          resourceId,
          detail: `${resource.label} supera la capacità ${resource.capacity} nella finestra richiesta.`,
        });
      }
    }
  }

  return { feasible: conflicts.length === 0, conflicts, checkedAt: new Date().toISOString() };
}

export function planningStatus(evaluation: PlanningEvaluation) {
  return evaluation.feasible ? "FEASIBLE" : "CONFLICTED";
}

