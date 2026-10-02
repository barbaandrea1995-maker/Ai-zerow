export const OUTBOX_MAX_ATTEMPTS = 5;

export const OUTBOX_ACTIONS = ["retry", "dead_letter", "requeue", "block"] as const;
export type OutboxAction = (typeof OUTBOX_ACTIONS)[number];

export const OUTBOX_TERMINAL_STATUSES = new Set([
  "DELIVERED",
  "DEAD_LETTERED",
]);

export type OutboxTransitionInput = {
  status: string;
  attempts: number;
  action: OutboxAction;
};

export type OutboxTransition = {
  nextStatus: string;
  nextAttempts: number;
  detail: string;
};

export class OutboxTransitionError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

/**
 * Local delivery-control state machine. It never marks an item delivered:
 * only an authorized external consumer may produce that evidence.
 */
export function transitionOutbox(input: OutboxTransitionInput): OutboxTransition {
  const status = input.status.trim().toUpperCase();
  const attempts = Number.isInteger(input.attempts) && input.attempts >= 0 ? input.attempts : 0;
  if (OUTBOX_TERMINAL_STATUSES.has(status)) {
    throw new OutboxTransitionError("outbox_terminal_status");
  }

  if (input.action === "retry") {
    if (!["PENDING_EXTERNAL_CONSUMER", "FAILED_RETRYABLE", "RECONCILE_REQUIRED"].includes(status)) {
      throw new OutboxTransitionError("outbox_retry_not_allowed");
    }
    const nextAttempts = attempts + 1;
    if (nextAttempts >= OUTBOX_MAX_ATTEMPTS) {
      return {
        nextStatus: "DEAD_LETTERED",
        nextAttempts,
        detail: `Retry budget exhausted at ${OUTBOX_MAX_ATTEMPTS} attempts; external delivery remains unverified.`,
      };
    }
    return {
      nextStatus: "PENDING_EXTERNAL_CONSUMER",
      nextAttempts,
      detail: `Retry ${nextAttempts}/${OUTBOX_MAX_ATTEMPTS} queued; external delivery remains unverified.`,
    };
  }

  if (input.action === "dead_letter") {
    return {
      nextStatus: "DEAD_LETTERED",
      nextAttempts: attempts,
      detail: "Moved to the Sites dead-letter boundary; no external delivery was claimed.",
    };
  }

  if (input.action === "requeue") {
    if (!["DEAD_LETTERED", "FAILED_PERMANENT", "BLOCKED_EXTERNAL_CONSUMER", "RECONCILE_REQUIRED"].includes(status)) {
      throw new OutboxTransitionError("outbox_requeue_not_allowed");
    }
    return {
      nextStatus: "PENDING_EXTERNAL_CONSUMER",
      nextAttempts: attempts,
      detail: "Manually requeued for an authorized external consumer; no delivery was claimed.",
    };
  }

  if (!["PENDING_EXTERNAL_CONSUMER", "FAILED_RETRYABLE", "FAILED_PERMANENT", "RECONCILE_REQUIRED"].includes(status)) {
    throw new OutboxTransitionError("outbox_block_not_allowed");
  }
  return {
    nextStatus: "BLOCKED_EXTERNAL_CONSUMER",
    nextAttempts: attempts,
    detail: "Blocked because the external consumer is not configured or its evidence is insufficient.",
  };
}
