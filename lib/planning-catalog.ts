export const PLANNING_ACTIVITY_TYPES = [
  {
    value: "WORK",
    label: "Lavorazione commessa",
    description: "Attività di cantiere con persone, squadre e asset operativi.",
    resourceProfile: "operations",
    allowedJobModules: ["operations"],
  },
  {
    value: "TRANSPORT",
    label: "Trasporto / missione",
    description: "Finestra logistica con autista di consegna e mezzo di trasporto.",
    resourceProfile: "mission",
    allowedJobModules: ["operations", "mission"],
  },
] as const;

export const PLANNING_PRIORITIES = [
  { value: "STANDARD", label: "Standard" },
  { value: "HIGH", label: "Alta" },
  { value: "CRITICAL", label: "Critica" },
] as const;

export type PlanningActivityType = (typeof PLANNING_ACTIVITY_TYPES)[number]["value"];
export type PlanningPriority = (typeof PLANNING_PRIORITIES)[number]["value"];
export type PlanningJobModule = "operations" | "mission";
export type PlanningResourceProfile = "operations" | "mission";

export function planningActivityType(value: unknown, jobModule: PlanningJobModule): PlanningActivityType | null {
  const requested = typeof value === "string" ? value.trim().toUpperCase() : "";
  const fallback: PlanningActivityType = jobModule === "mission" ? "TRANSPORT" : "WORK";
  const normalized = requested || fallback;
  const entry = PLANNING_ACTIVITY_TYPES.find((candidate) => candidate.value === normalized);
  return entry?.allowedJobModules.some((module) => module === jobModule) ? entry.value : null;
}

export function planningPriority(value: unknown): PlanningPriority | null {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "STANDARD";
  return PLANNING_PRIORITIES.some((candidate) => candidate.value === normalized)
    ? normalized as PlanningPriority
    : null;
}

export function planningResourceProfile(activityType: PlanningActivityType): PlanningResourceProfile {
  return PLANNING_ACTIVITY_TYPES.find((candidate) => candidate.value === activityType)?.resourceProfile ?? "operations";
}

export function planningCatalog() {
  return {
    activityTypes: PLANNING_ACTIVITY_TYPES.map((entry) => ({ ...entry, allowedJobModules: [...entry.allowedJobModules] })),
    priorities: PLANNING_PRIORITIES.map((entry) => ({ ...entry })),
  };
}
