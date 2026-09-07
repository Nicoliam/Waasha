/**
 * Slice 18 — error classification + backoff.
 *
 * Classification policy (blueprint §39-41):
 * - network/timeout/5xx (no server verdict or server busy) → TRANSIENT (retry, bounded)
 * - 401/419/440 → AUTH (pause, never blind-retry; resume after re-auth)
 * - 403 → FORBIDDEN treated as PERMANENT failure kind FORBIDDEN (explicit, no retry)
 * - 409, or known conflict codes (slot/stock/assignment) → CONFLICT (server wins, user reviews)
 * - other 4xx → PERMANENT (validation/authz/business-rule — user action required)
 */
import type { RetryPolicy, SyncErrorKind } from './sync-types';

/** Server codes that mean "server state moved — user must review", never blind retry. */
export const CONFLICT_CODES: ReadonlySet<string> = new Set([
  'BOOKING_CONFLICT',
  'INSUFFICIENT_STOCK',
  'ASSIGNMENT_CONFLICT',
  'SLOT_TAKEN',
  'SLOT_UNAVAILABLE',
  'RESOURCE_CONFLICT',
  'VERSION_CONFLICT',
  'CASH_CAP_EXCEEDED',
]);

const AUTH_STATUSES: ReadonlySet<number> = new Set([401, 419, 440]);

export interface ClassifiedError {
  kind: SyncErrorKind;
  /** Safe UI message (falls back to generic wording; never echoes raw bodies). */
  message: string;
  code?: string;
  status?: number;
  noServerVerdict: boolean;
}

export function classifySyncError(input: {
  status?: number;
  code?: string;
  message?: string;
  network?: boolean;
  timeout?: boolean;
}): ClassifiedError {
  const code = typeof input.code === 'string' && input.code.length > 0 ? input.code : undefined;
  const status = input.status;
  if (input.network || input.timeout || status === undefined) {
    return {
      kind: 'TRANSIENT',
      message: 'Connection problem. Will retry automatically.',
      code,
      status,
      noServerVerdict: true,
    };
  }
  if (AUTH_STATUSES.has(status)) {
    return {
      kind: 'AUTH',
      message: 'Session expired. Please sign in again to continue syncing.',
      code,
      status,
      noServerVerdict: false,
    };
  }
  if (status === 403) {
    return {
      kind: 'FORBIDDEN',
      message: 'Not permitted. This change was not applied — nothing was changed on the server.',
      code,
      status,
      noServerVerdict: false,
    };
  }
  if (status === 409 || (code !== undefined && CONFLICT_CODES.has(code))) {
    return {
      kind: 'CONFLICT',
      message: conflictMessage(code),
      code,
      status,
      noServerVerdict: false,
    };
  }
  if (status >= 500) {
    return {
      kind: 'TRANSIENT',
      message: 'Server busy. Will retry automatically.',
      code,
      status,
      noServerVerdict: false,
    };
  }
  // Any other 4xx: validation / business-rule rejection — permanent, needs user action.
  return {
    kind: 'PERMANENT',
    message: input.message && input.message.length > 0 && input.message.length <= 300
      ? input.message
      : 'Could not sync. Please review and try again.',
    code,
    status,
    noServerVerdict: false,
  };
}

function conflictMessage(code?: string): string {
  switch (code) {
    case 'BOOKING_CONFLICT':
    case 'SLOT_TAKEN':
    case 'SLOT_UNAVAILABLE':
      return 'That time is no longer available. Please choose another time — nothing was booked.';
    case 'INSUFFICIENT_STOCK':
      return 'Stock changed on the server. This sale was not applied — please review quantities.';
    case 'CASH_CAP_EXCEEDED':
      return 'Cash limit changed on the server. This request was not applied — please review.';
    default:
      return 'The server state changed. Please review — nothing was applied automatically.';
  }
}

/** Bounded exponential backoff with symmetric jitter. Deterministic given random(). */
export function computeBackoffMs(
  attemptCount: number,
  policy: RetryPolicy,
  random: () => number = Math.random,
): number {
  const exp = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** Math.max(0, attemptCount - 1));
  const jitter = exp * policy.jitterRatio * (random() * 2 - 1);
  return Math.max(0, Math.round(exp + jitter));
}
