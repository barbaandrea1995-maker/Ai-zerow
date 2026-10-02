export const W10_MODULES = {
  procurement: {
    read: "procurement.read",
    write: "procurement.write",
    initialStatus: "NEED",
  },
  finance: {
    read: "finance.read",
    write: "finance.write",
    initialStatus: "PROPOSED",
  },
} as const;

export type W10Module = keyof typeof W10_MODULES;
export type ProcurementStatus = (typeof PROCUREMENT_STATUSES)[number];
export type FinanceStatus = (typeof FINANCE_STATUSES)[number];
export type W10Status = ProcurementStatus | FinanceStatus;
export type W10Action = (typeof W10_ACTIONS)[number];

export const PROCUREMENT_STATUSES = [
  "NEED",
  "REQUESTED",
  "REVIEW",
  "APPROVED",
  "PO_DRAFT",
  "PO_ISSUED",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "RECONCILED",
] as const;

export const FINANCE_STATUSES = ["PROPOSED", "REVIEW", "APPROVED", "RECONCILED"] as const;

export const W10_ACTIONS = [
  "request",
  "submit_review",
  "approve",
  "prepare_po",
  "external_issue",
  "receive_partial",
  "receive",
  "reconcile",
] as const;

type Transition = {
  from: readonly string[];
  to: W10Status;
  requiresApproval?: boolean;
  externalOnly?: boolean;
};

const TRANSITIONS: Record<W10Module, Partial<Record<W10Action, Transition>>> = {
  procurement: {
    request: { from: ["NEED"], to: "REQUESTED" },
    submit_review: { from: ["REQUESTED"], to: "REVIEW" },
    approve: { from: ["REVIEW"], to: "APPROVED", requiresApproval: true },
    prepare_po: { from: ["APPROVED"], to: "PO_DRAFT" },
    external_issue: { from: ["PO_DRAFT"], to: "PO_ISSUED", externalOnly: true },
    receive_partial: { from: ["PO_ISSUED", "PARTIALLY_RECEIVED"], to: "PARTIALLY_RECEIVED", externalOnly: true },
    receive: { from: ["PO_ISSUED", "PARTIALLY_RECEIVED"], to: "RECEIVED", externalOnly: true },
    reconcile: { from: ["RECEIVED"], to: "RECONCILED" },
  },
  finance: {
    submit_review: { from: ["PROPOSED"], to: "REVIEW" },
    approve: { from: ["REVIEW"], to: "APPROVED", requiresApproval: true },
    reconcile: { from: ["APPROVED"], to: "RECONCILED" },
  },
};

export class W10TransitionError extends Error {
  public readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "W10TransitionError";
    this.code = code;
  }
}

export function isW10Module(value: string): value is W10Module {
  return value === "procurement" || value === "finance";
}

export function isW10Status(module: W10Module, value: string): boolean {
  return module === "procurement"
    ? (PROCUREMENT_STATUSES as readonly string[]).includes(value)
    : (FINANCE_STATUSES as readonly string[]).includes(value);
}

export function transitionW10Workflow(input: {
  module: W10Module;
  status: string;
  action: string;
}) {
  const action = input.action as W10Action;
  const transition = TRANSITIONS[input.module][action];
  if (!transition || !transition.from.includes(input.status)) {
    throw new W10TransitionError("w10_invalid_transition");
  }
  return {
    action,
    fromStatus: input.status,
    nextStatus: transition.to,
    requiresApproval: Boolean(transition.requiresApproval),
    externalOnly: Boolean(transition.externalOnly),
  };
}

export function w10Progress(module: W10Module, status: string): number {
  const statuses = module === "procurement" ? PROCUREMENT_STATUSES : FINANCE_STATUSES;
  const index = statuses.indexOf(status as never);
  return index < 0 ? 0 : Math.round((index / Math.max(statuses.length - 1, 1)) * 100);
}

export function w10NextActions(module: W10Module, status: string): W10Action[] {
  return W10_ACTIONS.filter((action) => {
    const transition = TRANSITIONS[module][action];
    return Boolean(transition && transition.from.includes(status));
  });
}

export function w10ExternalStatus(status: string): "SITES_READY" | "EXTERNAL_DEFERRED" | "RECONCILED" {
  if (status === "RECONCILED") return "RECONCILED";
  if (["PO_ISSUED", "PARTIALLY_RECEIVED", "RECEIVED"].includes(status)) return "EXTERNAL_DEFERRED";
  return "SITES_READY";
}
