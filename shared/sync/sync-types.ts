/**
 * Slice 18 — Offline-first sync core: shared types.
 *
 * Blueprint Document 16 (Offline-First & Synchronization Architecture).
 * Framework-agnostic: no Angular/Ionic/Node imports. Usable from web,
 * mobile (Capacitor) and Node tests. The server is always authoritative;
 * queueing is NEVER success.
 */

export type SyncOpState =
  | 'PENDING'
  | 'SYNCING'
  | 'SYNCED'
  | 'RETRYING'
  | 'FAILED'
  | 'BLOCKED_ON_AUTH'
  | 'CONFLICT'
  | 'CANCELLED';

/** Terminal states: the engine will never auto-process these again. */
export const TERMINAL_STATES: ReadonlySet<SyncOpState> = new Set([
  'SYNCED',
  'FAILED',
  'CONFLICT',
  'CANCELLED',
]);

/** States that require explicit user attention (dead-letter). */
export const ATTENTION_STATES: ReadonlySet<SyncOpState> = new Set([
  'FAILED',
  'CONFLICT',
  'BLOCKED_ON_AUTH',
]);

export type SyncErrorKind =
  | 'TRANSIENT'
  | 'AUTH'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'PERMANENT';

export interface SyncErrorMeta {
  /** HTTP status when the failure came from the server (undefined = never reached server). */
  status?: number;
  /** Server error code (e.g. BOOKING_CONFLICT, INSUFFICIENT_STOCK). Never trusted for authority. */
  code?: string;
  /** Human-safe message for UI (never includes secrets — enforced at enqueue + executor). */
  message: string;
  /** True when the request never got a server verdict (network/timeout) — safe to retry. */
  noServerVerdict: boolean;
  at: string;
}

export interface SyncScope {
  /** Session user id captured at enqueue — routing/ownership only, never authority. */
  userId: string;
  /** Tenant discriminator for cache isolation (e.g. PROVIDER, BUSINESS, PARTNER, CUSTOMER). */
  tenantKind: string;
  /** Tenant id where applicable (provider id, business id, partner id). Never authority. */
  tenantId?: string | null;
}

/**
 * A queued operation. Payloads must never contain secrets (enforced by
 * assertQueuePayloadSafe at enqueue): no passwords, tokens, card data, keys.
 */
export interface SyncOp {
  /** Deterministic client operation id (uuid). Stable across retries/restarts. */
  id: string;
  /** Registry key, e.g. pos.sale.create. Unknown keys are rejected at enqueue. */
  type: string;
  scope: SyncScope;
  payload: Record<string, unknown>;
  /** Deterministic idempotency key sent to the server (`installationId:opId`). */
  idempotencyKey: string;
  /** Op ids that must be SYNCED before this op runs. */
  dependsOn: string[];
  state: SyncOpState;
  attemptCount: number;
  /** Next eligible attempt (ISO). Honored by the scheduler for backoff. */
  notBefore: string | null;
  lastError: SyncErrorMeta | null;
  serverId: string | null;
  syncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EnqueueInput {
  type: string;
  scope: SyncScope;
  payload?: Record<string, unknown>;
  dependsOn?: string[];
}

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Jitter ratio 0..1 applied symmetrically (±). */
  jitterRatio: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 5,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitterRatio: 0.25,
};

export type ConnectivityState =
  | 'ONLINE'
  | 'LIMITED'
  | 'OFFLINE'
  | 'SYNCING'
  | 'SYNC_ERROR';

export interface SyncEngineEvents {
  onQueueChanged?: (ops: SyncOp[]) => void;
  onConnectivityChanged?: (state: ConnectivityState) => void;
  /** Fired after an op reaches SYNCED — UI must refresh from server, never trust local. */
  onOpSynced?: (op: SyncOp) => void;
}

/** Result returned by the platform executor for one attempt. */
export type ExecResult =
  | { ok: true; serverId?: string | null }
  | { ok: false; error: { status?: number; code?: string; message?: string; network?: boolean; timeout?: boolean } };

export type Executor = (op: SyncOp) => Promise<ExecResult>;
