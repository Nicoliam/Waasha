/**
 * Slice 18 — durable operation queue + sync scheduler.
 *
 * Guarantees:
 * - Queueing is never success: ops sit PENDING until a server verdict arrives.
 * - One attempt at a time (single-flight), FIFO, dependency-ordered.
 * - Every attempt carries the op's stable idempotency key, so a retry after
 *   an interrupted success is deduplicated server-side instead of duplicated.
 * - 401 pauses the queue (never blind-retries auth); resume is explicit.
 * - Bounded retries with backoff; terminal dead-letter states need the user.
 * - Restart-safe: SYNCING rows revert to PENDING on init and are retried
 *   with the SAME idempotency key (server verdict unknown → replay safely).
 */
import { ConnectivityMonitor } from './connectivity';
import { classifySyncError, computeBackoffMs } from './sync-classify';
import {
  assertQueuePayloadSafe,
  loadMeta,
  loadQueue,
  MAX_QUEUE_OPS,
  pruneQueue,
  saveMeta,
  saveQueue,
  type Clock,
  type SyncStorage,
  systemClock,
} from './sync-store';
import type {
  EnqueueInput,
  Executor,
  RetryPolicy,
  SyncEngineEvents,
  SyncOp,
  SyncScope,
} from './sync-types';
import { DEFAULT_RETRY_POLICY } from './sync-types';
import { isSyncableOp } from './op-registry';

export interface EngineDeps {
  storage: SyncStorage;
  executor: Executor;
  connectivity: ConnectivityMonitor;
  clock?: Clock;
  random?: () => number;
  uuid?: () => string;
  retryPolicy?: RetryPolicy;
  events?: SyncEngineEvents;
}

function defaultUuid(): string {
  try {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c?.randomUUID) return c.randomUUID();
  } catch {
    // Fall through to Math fallback below.
  }
  return `op-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffffffff).toString(36)}`;
}

function isoNow(clock: Clock): string {
  return clock.now().toISOString();
}

export class SyncEngine {
  private readonly storage: SyncStorage;
  private readonly executor: Executor;
  private readonly connectivity: ConnectivityMonitor;
  private readonly clock: Clock;
  private readonly random: () => number;
  private readonly uuid: () => string;
  private readonly policy: RetryPolicy;
  private readonly events: SyncEngineEvents;

  private userId: string | null = null;
  private installationId = '';
  private ops: SyncOp[] = [];
  private running = false;
  private pausedForAuth = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(deps: EngineDeps) {
    this.storage = deps.storage;
    this.executor = deps.executor;
    this.connectivity = deps.connectivity;
    this.clock = deps.clock ?? systemClock;
    this.random = deps.random ?? Math.random;
    this.uuid = deps.uuid ?? defaultUuid;
    this.policy = deps.retryPolicy ?? DEFAULT_RETRY_POLICY;
    this.events = deps.events ?? {};
  }

  /** Bind the engine to a session user (loads ONLY that user's queue). */
  async init(userId: string): Promise<void> {
    this.userId = userId;
    const [ops, meta] = await Promise.all([loadQueue(this.storage, userId), loadMeta(this.storage, userId)]);
    // Restart recovery: an op left SYNCING never received a verdict — replay
    // with the SAME idempotency key so the server dedupes instead of duplicating.
    for (const op of ops) {
      if (op.state === 'SYNCING') {
        op.state = 'PENDING';
        op.notBefore = null;
        op.updatedAt = isoNow(this.clock);
      }
    }
    this.ops = pruneQueue(ops, this.clock.now().getTime());
    this.installationId = meta?.installationId ?? this.uuid();
    await saveMeta(this.storage, userId, { installationId: this.installationId, updatedAt: isoNow(this.clock) });
    await this.persist();
  }

  snapshot(): SyncOp[] {
    return this.ops.map((o) => ({ ...o, payload: { ...o.payload }, dependsOn: [...o.dependsOn] }));
  }

  pendingCount(): number {
    return this.ops.filter((o) => o.state === 'PENDING' || o.state === 'RETRYING' || o.state === 'SYNCING').length;
  }

  attentionCount(): number {
    return this.ops.filter((o) => o.state === 'FAILED' || o.state === 'CONFLICT' || o.state === 'BLOCKED_ON_AUTH').length;
  }

  /**
   * Queue a syncable operation. Throws for unknown types, unsafe payloads,
   * unknown dependencies, tenant mismatch, or a full queue. Never executes
   * inline: the op runs through the scheduler (or waits for connectivity).
   */
  async enqueue(input: EnqueueInput): Promise<SyncOp> {
    if (!this.userId) throw Object.assign(new Error('Sync engine not initialized'), { code: 'SYNC_NOT_READY' });
    if (!isSyncableOp(input.type)) {
      throw Object.assign(new Error(`Operation "${input.type}" is online-only and cannot be queued`), {
        code: 'SYNC_ONLINE_ONLY',
      });
    }
    if (input.scope.userId !== this.userId) {
      throw Object.assign(new Error('Queue scope does not match the active session'), { code: 'SYNC_TENANT_MISMATCH' });
    }
    const payload = { ...(input.payload ?? {}) };
    assertQueuePayloadSafe(payload);
    const dependsOn = [...(input.dependsOn ?? [])];
    for (const dep of dependsOn) {
      if (!this.ops.some((o) => o.id === dep)) {
        throw Object.assign(new Error(`Unknown dependency "${dep}"`), { code: 'SYNC_UNKNOWN_DEPENDENCY' });
      }
    }
    const active = this.ops.filter((o) => o.state !== 'SYNCED' && o.state !== 'CANCELLED').length;
    if (active >= MAX_QUEUE_OPS) {
      throw Object.assign(new Error('Sync queue is full — resolve pending items first'), { code: 'SYNC_QUEUE_FULL' });
    }
    const now = isoNow(this.clock);
    const id = this.uuid();
    const op: SyncOp = {
      id,
      type: input.type,
      scope: { ...input.scope },
      payload,
      idempotencyKey: `${this.installationId}:${id}`,
      dependsOn,
      state: 'PENDING',
      attemptCount: 0,
      notBefore: null,
      lastError: null,
      serverId: null,
      syncedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.ops.push(op);
    await this.persist();
    this.kick();
    return { ...op };
  }

  /** Manual retry of a dead-letter op (explicit user action; attempts reset). */
  async retryOp(id: string): Promise<void> {
    const op = this.requireOp(id);
    if (op.state !== 'FAILED' && op.state !== 'CONFLICT' && op.state !== 'BLOCKED_ON_AUTH') return;
    op.state = 'PENDING';
    op.attemptCount = 0;
    op.notBefore = null;
    op.lastError = null;
    op.updatedAt = isoNow(this.clock);
    await this.persist();
    this.kick();
  }

  async cancelOp(id: string): Promise<void> {
    const op = this.requireOp(id);
    if (op.state === 'SYNCED' || op.state === 'CANCELLED') return;
    op.state = 'CANCELLED';
    op.updatedAt = isoNow(this.clock);
    await this.persist();
  }

  /** Auth was restored (re-login): resume blocked ops. Never called implicitly. */
  notifyAuthRestored(): void {
    let changed = false;
    for (const op of this.ops) {
      if (op.state === 'BLOCKED_ON_AUTH') {
        op.state = 'PENDING';
        op.notBefore = null;
        op.updatedAt = isoNow(this.clock);
        changed = true;
      }
    }
    this.pausedForAuth = false;
    if (changed) void this.persist();
    this.kick();
  }

  notifyLogout(): void {
    this.pausedForAuth = true;
    this.clearTimer();
  }

  /** Trigger a scheduler pass (reconnect, manual "sync now", new op). */
  kick(): void {
    if (this.running || this.pausedForAuth || !this.userId) return;
    if (!this.connectivity.online) return;
    void this.drain();
  }

  /** Test/UX helper: resolves once any in-flight drain completes. */
  async awaitIdle(): Promise<void> {
    for (let i = 0; i < 1000 && this.running; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  private requireOp(id: string): SyncOp {
    const op = this.ops.find((o) => o.id === id);
    if (!op) throw Object.assign(new Error('Queued operation not found'), { code: 'SYNC_OP_NOT_FOUND' });
    if (op.scope.userId !== this.userId) {
      throw Object.assign(new Error('Queued operation belongs to another session'), { code: 'SYNC_TENANT_MISMATCH' });
    }
    return op;
  }

  private nextRunnable(): SyncOp | undefined {
    const nowMs = this.clock.now().getTime();
    const byId = new Map(this.ops.map((o) => [o.id, o]));
    return (
      this.ops
        .filter((o) => o.state === 'PENDING' || o.state === 'RETRYING')
        .filter((o) => !o.notBefore || new Date(o.notBefore).getTime() <= nowMs)
        // A dependent runs only after ALL dependencies reached SYNCED.
        .filter((o) => o.dependsOn.every((d) => byId.get(d)?.state === 'SYNCED'))
        .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))[0]
    );
  }

  /** Fail dependents whose dependencies can never succeed (no silent stall). */
  private failBlockedDependents(): boolean {
    const byId = new Map(this.ops.map((o) => [o.id, o]));
    let changed = false;
    for (const op of this.ops) {
      if (op.state !== 'PENDING' && op.state !== 'RETRYING') continue;
      const dead = op.dependsOn.some((d) => {
        const dep = byId.get(d);
        return !dep || dep.state === 'FAILED' || dep.state === 'CONFLICT' || dep.state === 'CANCELLED';
      });
      if (dead) {
        op.state = 'FAILED';
        op.lastError = {
          message: 'A required earlier change failed, so this was not applied. Review and retry.',
          code: 'DEPENDENCY_UNMET',
          noServerVerdict: true,
          at: isoNow(this.clock),
        };
        op.updatedAt = isoNow(this.clock);
        changed = true;
      }
    }
    return changed;
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.connectivity.markSyncing();
    try {
      for (;;) {
        if (this.pausedForAuth || !this.connectivity.online) break;
        if (this.failBlockedDependents()) await this.persist();
        const op = this.nextRunnable();
        if (!op) break;
        await this.attempt(op);
      }
    } finally {
      this.running = false;
      this.connectivity.markIdle();
      this.scheduleNext();
    }
  }

  private async attempt(op: SyncOp): Promise<void> {
    op.state = 'SYNCING';
    op.attemptCount += 1;
    op.updatedAt = isoNow(this.clock);
    await this.persist();
    let result: Awaited<ReturnType<Executor>>;
    try {
      result = await this.executor({ ...op, payload: { ...op.payload }, dependsOn: [...op.dependsOn] });
    } catch (e) {
      // Executor threw (programming/transport fault): treat as transient, bounded.
      result = { ok: false, error: { network: true, message: e instanceof Error ? e.message : 'Sync transport failed' } };
    }
    if (result.ok) {
      op.state = 'SYNCED';
      op.serverId = result.serverId ?? null;
      op.syncedAt = isoNow(this.clock);
      op.lastError = null;
      op.updatedAt = op.syncedAt;
      this.connectivity.observe(true);
      await this.persist();
      try {
        this.events.onOpSynced?.({ ...op });
      } catch {
        // UI callbacks must never break the scheduler.
      }
      return;
    }
    const c = classifySyncError(result.error);
    op.lastError = {
      status: c.status,
      code: c.code,
      message: c.message,
      noServerVerdict: c.noServerVerdict,
      at: isoNow(this.clock),
    };
    op.updatedAt = op.lastError.at;
    switch (c.kind) {
      case 'TRANSIENT': {
        this.connectivity.observe(false);
        if (op.attemptCount >= this.policy.maxAttempts) {
          op.state = 'FAILED';
          op.lastError = { ...op.lastError, code: 'RETRIES_EXHAUSTED', message: 'Could not reach the server after several tries. Kept safely — retry when ready.' };
        } else {
          op.state = 'RETRYING';
          op.notBefore = new Date(this.clock.now().getTime() + computeBackoffMs(op.attemptCount, this.policy, this.random)).toISOString();
        }
        break;
      }
      case 'AUTH': {
        op.state = 'BLOCKED_ON_AUTH';
        this.pausedForAuth = true;
        break;
      }
      case 'FORBIDDEN': {
        op.state = 'FAILED';
        op.lastError = { ...op.lastError, code: 'FORBIDDEN' };
        break;
      }
      case 'CONFLICT': {
        op.state = 'CONFLICT';
        break;
      }
      case 'PERMANENT': {
        op.state = 'FAILED';
        break;
      }
    }
    await this.persist();
  }

  private scheduleNext(): void {
    this.clearTimer();
    if (this.pausedForAuth || !this.userId) return;
    const pending = this.ops.some((o) => o.state === 'PENDING' || o.state === 'RETRYING' || o.state === 'BLOCKED_ON_AUTH');
    if (!pending) return;
    const nowMs = this.clock.now().getTime();
    let delay = 5000;
    for (const o of this.ops) {
      if ((o.state === 'RETRYING' || o.state === 'PENDING') && o.notBefore) {
        delay = Math.min(delay, Math.max(0, new Date(o.notBefore).getTime() - nowMs));
      }
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.kick();
    }, Math.min(delay, this.policy.maxDelayMs));
    if (typeof (this.timer as unknown as { unref?: () => void }).unref === 'function') {
      (this.timer as unknown as { unref: () => void }).unref();
    }
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async persist(): Promise<void> {
    if (!this.userId) return;
    // Chain writes so overlapping persists can never drop an update.
    this.writeChain = this.writeChain
      .then(() => saveQueue(this.storage, this.userId as string, this.ops))
      .catch(() => undefined);
    await this.writeChain;
    try {
      this.events.onQueueChanged?.(this.snapshot());
    } catch {
      // UI callbacks must never break persistence.
    }
  }
}

export type { SyncScope };
